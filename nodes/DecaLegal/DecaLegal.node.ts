import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { compact, decaLegalApiRequest, idempotencyKey, waitForOperation } from './GenericFunctions';

const addressFields = (prefix: string) => [
	{ displayName: 'Street and Number', name: `${prefix}Line1`, type: 'string' as const, default: '' },
	{ displayName: 'Postal Code', name: `${prefix}PostalCode`, type: 'string' as const, default: '' },
	{ displayName: 'Locality', name: `${prefix}Locality`, type: 'string' as const, default: '' },
	{ displayName: 'Province', name: `${prefix}Province`, type: 'string' as const, default: '' },
];

export class DecaLegal implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DecaLegal',
		name: 'decaLegal',
		icon: 'file:decalegal.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Create transports, issue the Spanish DeCA (electronic road transport control document) and search your catalogs in DecaLegal',
		defaults: { name: 'DecaLegal' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'decaLegalApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Catalog', value: 'catalog' },
					{ name: 'Document (DeCA)', value: 'document' },
					{ name: 'Import', value: 'import' },
					{ name: 'Transport', value: 'transport' },
				],
				default: 'transport',
			},

			// Transport
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['transport'] } },
				options: [
					{ name: 'Complete', value: 'complete', action: 'Record the real end of a transport', description: 'Record when the service really finished' },
					{ name: 'Create', value: 'create', action: 'Create a transport', description: 'Create a transport from your order or delivery note' },
					{ name: 'Get', value: 'get', action: 'Get a transport', description: 'Get a transport by ID' },
					{ name: 'List', value: 'list', action: 'List transports', description: 'List transports, newest first' },
				],
				default: 'create',
			},
			{
				displayName: 'Transport ID',
				name: 'transportId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['transport'], operation: ['get', 'complete'] } },
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'ALB-2026-0457',
				description: 'Your reference for this transport: the order or delivery note number. DecaLegal keeps it to link both systems.',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
			},
			{
				displayName: 'Source System',
				name: 'sourceSystem',
				type: 'string',
				default: 'n8n',
				description: 'Name of the system the transport comes from',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
			},
			{
				displayName: 'Carrier',
				name: 'carrier',
				type: 'collection',
				placeholder: 'Add Carrier Field',
				default: {},
				description: 'The company that actually moves the goods (transportista efectivo)',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Legal Name', name: 'legalName', type: 'string', default: '' },
					{ displayName: 'Tax ID (NIF)', name: 'taxId', type: 'string', default: '' },
					{ displayName: 'Tax Country', name: 'taxCountry', type: 'string', default: 'ES' },
					...addressFields('address'),
				],
			},
			{
				displayName: 'Contractual Loader',
				name: 'loader',
				type: 'collection',
				placeholder: 'Add Loader Field',
				default: {},
				description: 'Who contracts the transport (cargador contractual). Leave empty when it is your own company.',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Legal Name', name: 'legalName', type: 'string', default: '' },
					{ displayName: 'Tax ID (NIF)', name: 'taxId', type: 'string', default: '' },
					{ displayName: 'Tax Country', name: 'taxCountry', type: 'string', default: 'ES' },
					...addressFields('address'),
				],
			},
			{
				displayName: 'Origin',
				name: 'origin',
				type: 'collection',
				placeholder: 'Add Origin Field',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Label', name: 'label', type: 'string', default: '', description: 'Name of the place as it should print on the document' },
					{ displayName: 'Country', name: 'country', type: 'string', default: 'ES' },
					...addressFields('address'),
				],
			},
			{
				displayName: 'Destination',
				name: 'destination',
				type: 'collection',
				placeholder: 'Add Destination Field',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Label', name: 'label', type: 'string', default: '' },
					{ displayName: 'Country', name: 'country', type: 'string', default: 'ES' },
					...addressFields('address'),
				],
			},
			{
				displayName: 'Transport Date',
				name: 'transportDate',
				type: 'string',
				default: '={{ $today.toFormat("yyyy-MM-dd") }}',
				required: true,
				description: 'Day the transport takes place (YYYY-MM-DD)',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
			},
			{
				displayName: 'Vehicle',
				name: 'vehicle',
				type: 'collection',
				placeholder: 'Add Vehicle Field',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Motor Plate', name: 'motorPlate', type: 'string', default: '', placeholder: '1234BCD' },
					{ displayName: 'Motor Country', name: 'motorCountry', type: 'string', default: 'ES' },
					{ displayName: 'Trailer Plate', name: 'trailerPlate', type: 'string', default: '', placeholder: 'R1234BCD' },
					{ displayName: 'Trailer Country', name: 'trailerCountry', type: 'string', default: 'ES' },
					{
						displayName: 'Configuration',
						name: 'configuration',
						type: 'options',
						options: [
							{ name: 'Decide From the Plates', value: '' },
							{ name: 'Articulated (Tractor + Trailer)', value: 'articulated' },
							{ name: 'Rigid', value: 'rigid' },
						],
						default: '',
					},
				],
			},
			{
				displayName: 'Goods',
				name: 'goods',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Goods Line',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{
						name: 'line',
						displayName: 'Line',
						values: [
							{ displayName: 'Description', name: 'description', type: 'string', default: '' },
							{ displayName: 'Weight (Kg)', name: 'weightKg', type: 'string', default: '', description: 'Weight in kilograms; decimals with a dot' },
						],
					},
				],
			},
			{
				displayName: 'Ordinary Goods Confirmed',
				name: 'ordinaryGoodsConfirmed',
				type: 'boolean',
				default: true,
				description: 'Whether the goods are ordinary (no dangerous goods, waste or animal by-products). Required to issue the DeCA; leave off to review it in the portal first.',
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['create'] } },
				options: [
					{ displayName: 'Driver ID Number', name: 'driverIdNumber', type: 'string', default: '' },
					{ displayName: 'Driver Name', name: 'driverName', type: 'string', default: '' },
					{ displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', default: '', description: 'Your own key (16-128 characters). By default one is derived from the execution.' },
					{ displayName: 'Internal Reference', name: 'internalReference', type: 'string', default: '' },
					{ displayName: 'Observations', name: 'observations', type: 'string', default: '' },
					{ displayName: 'Raw JSON', name: 'rawJson', type: 'json', default: '{}', description: 'Any other field of the API transport input, merged on top of the fields above' },
					{ displayName: 'Route ID', name: 'runId', type: 'string', default: '' },
					{ displayName: 'Special Circulation Authorization', name: 'specialCirculationAuthorization', type: 'string', default: '', description: 'Identifier of the special circulation permit, when the vehicle needs one' },
				],
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['transport'], operation: ['list'] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['transport'], operation: ['list'] } },
				options: [
					{ displayName: 'External ID', name: 'externalId', type: 'string', default: '' },
					{ displayName: 'Status', name: 'status', type: 'string', default: '', description: 'Transport status as the API names it' },
				],
			},
			{
				displayName: 'Actual Finish',
				name: 'actualFinishedAt',
				type: 'string',
				default: '={{ $now.toUTC().toISO() }}',
				required: true,
				description: 'When the service really finished (ISO 8601, UTC)',
				displayOptions: { show: { resource: ['transport'], operation: ['complete'] } },
			},
			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['transport'], operation: ['complete'] } },
			},

			// Document
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a document', description: 'Prepare a DeCA from one or more transports' },
					{ name: 'Get', value: 'get', action: 'Get a document', description: 'Get a document with its current version, PDF and QR links' },
					{ name: 'Get Operation', value: 'getOperation', action: 'Get an operation', description: 'Check the progress of an issue operation' },
					{ name: 'Issue', value: 'issue', action: 'Issue a document', description: 'Issue the DeCA: PDF in custody and QR for inspection' },
				],
				default: 'issue',
			},
			{
				displayName: 'Transport IDs',
				name: 'shipmentIds',
				type: 'string',
				default: '',
				required: true,
				description: 'One or more transport IDs, comma-separated. They must share loader and carrier.',
				displayOptions: { show: { resource: ['document'], operation: ['create'] } },
			},
			{
				displayName: 'Document ID',
				name: 'documentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['get', 'issue'] } },
			},
			{
				displayName: 'Wait Until Published',
				name: 'wait',
				type: 'boolean',
				default: true,
				description: 'Whether to wait for the issue to finish and return the published version',
				displayOptions: { show: { resource: ['document'], operation: ['issue'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 120,
				typeOptions: { minValue: 5, maxValue: 600 },
				displayOptions: { show: { resource: ['document'], operation: ['issue'], wait: [true] } },
			},
			{
				displayName: 'Operation ID',
				name: 'operationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['getOperation'] } },
			},

			// Import
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['import'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get an import', description: 'Get an import with its items and issues' },
					{ name: 'Upload', value: 'upload', action: 'Upload a file to import', description: 'Upload a delivery note (PDF or image) to read with AI, or a spreadsheet' },
				],
				default: 'upload',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property that holds the file',
				displayOptions: { show: { resource: ['import'], operation: ['upload'] } },
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				options: [
					{ name: 'Document (PDF or Image, Read With AI)', value: 'document' },
					{ name: 'Spreadsheet (XLSX or CSV)', value: 'spreadsheet' },
				],
				default: 'document',
				displayOptions: { show: { resource: ['import'], operation: ['upload'] } },
			},
			{
				displayName: 'Mapping ID',
				name: 'mappingId',
				type: 'string',
				default: '',
				description: 'Saved column mapping to apply to a spreadsheet',
				displayOptions: { show: { resource: ['import'], operation: ['upload'], kind: ['spreadsheet'] } },
			},
			{
				displayName: 'Import ID',
				name: 'importId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['import'], operation: ['get'] } },
			},

			// Catalog
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['catalog'] } },
				options: [
					{ name: 'Search', value: 'search', action: 'Search a catalog', description: 'Find known companies, places, vehicles or goods' },
				],
				default: 'search',
			},
			{
				displayName: 'Catalog',
				name: 'kind',
				type: 'options',
				options: [
					{ name: 'Companies (Loaders and Carriers)', value: 'parties' },
					{ name: 'Goods', value: 'goods' },
					{ name: 'Places', value: 'locations' },
					{ name: 'Vehicles', value: 'vehicles' },
				],
				default: 'parties',
				displayOptions: { show: { resource: ['catalog'], operation: ['search'] } },
			},
			{
				displayName: 'Search Text',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Name, tax ID, plate or label. Empty returns the first entries.',
				displayOptions: { show: { resource: ['catalog'], operation: ['search'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 25 },
				default: 10,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['catalog'], operation: ['search'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let output: IDataObject | IDataObject[];

				if (resource === 'transport' && operation === 'create') {
					output = await createTransport.call(this, i);
				} else if (resource === 'transport' && operation === 'get') {
					output = await decaLegalApiRequest.call(this, 'GET', `/shipments/${encodeURIComponent(this.getNodeParameter('transportId', i) as string)}`);
				} else if (resource === 'transport' && operation === 'list') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const page = await decaLegalApiRequest.call(this, 'GET', '/shipments', undefined, compact({
						limit: this.getNodeParameter('limit', i) as number,
						status: filters.status,
						external_id: filters.externalId,
					}));
					output = (page.data ?? []) as IDataObject[];
				} else if (resource === 'transport' && operation === 'complete') {
					const transportId = this.getNodeParameter('transportId', i) as string;
					output = await decaLegalApiRequest.call(this, 'POST', `/shipments/${encodeURIComponent(transportId)}/complete`, compact({
						actual_finished_at: this.getNodeParameter('actualFinishedAt', i) as string,
						reason: this.getNodeParameter('reason', i, '') as string,
					}), undefined, { headers: { 'Idempotency-Key': idempotencyKey.call(this, i) } });
				} else if (resource === 'document' && operation === 'create') {
					const ids = (this.getNodeParameter('shipmentIds', i) as string).split(',').map((id) => id.trim()).filter((id) => id !== '');
					output = await decaLegalApiRequest.call(this, 'POST', '/documents', { shipment_ids: ids, regulatory_profile: 'deca_basic' }, undefined, {
						headers: { 'Idempotency-Key': idempotencyKey.call(this, i) },
					});
				} else if (resource === 'document' && operation === 'get') {
					output = await decaLegalApiRequest.call(this, 'GET', `/documents/${encodeURIComponent(this.getNodeParameter('documentId', i) as string)}`);
				} else if (resource === 'document' && operation === 'issue') {
					output = await issueDocument.call(this, i);
				} else if (resource === 'document' && operation === 'getOperation') {
					output = await decaLegalApiRequest.call(this, 'GET', `/operations/${encodeURIComponent(this.getNodeParameter('operationId', i) as string)}`);
				} else if (resource === 'import' && operation === 'upload') {
					output = await uploadImport.call(this, i);
				} else if (resource === 'import' && operation === 'get') {
					output = await decaLegalApiRequest.call(this, 'GET', `/imports/${encodeURIComponent(this.getNodeParameter('importId', i) as string)}`);
				} else if (resource === 'catalog' && operation === 'search') {
					const page = await decaLegalApiRequest.call(this, 'GET', '/catalog', undefined, compact({
						kind: this.getNodeParameter('kind', i) as string,
						q: this.getNodeParameter('query', i, '') as string,
						limit: this.getNodeParameter('limit', i) as number,
					}));
					output = (page.data ?? []) as IDataObject[];
				} else {
					throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported for ${resource}.`, { itemIndex: i });
				}

				const rows = Array.isArray(output) ? output : [output];
				results.push(...this.helpers.returnJsonArray(rows).map((row) => ({ ...row, pairedItem: { item: i } })));
			} catch (error) {
				if (this.continueOnFail()) {
					results.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });

					continue;
				}

				throw error;
			}
		}

		return [results];
	}
}

async function createTransport(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const carrier = this.getNodeParameter('carrier', i, {}) as IDataObject;
	const loader = this.getNodeParameter('loader', i, {}) as IDataObject;
	const origin = this.getNodeParameter('origin', i, {}) as IDataObject;
	const destination = this.getNodeParameter('destination', i, {}) as IDataObject;
	const vehicle = this.getNodeParameter('vehicle', i, {}) as IDataObject;
	const goods = (this.getNodeParameter('goods', i, {}) as { line?: IDataObject[] }).line ?? [];
	const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const trailerPlate = String(vehicle.trailerPlate ?? '').trim();
	const configuration = String(vehicle.configuration ?? '') || (trailerPlate !== '' ? 'articulated' : 'rigid');
	const authorization = String(additional.specialCirculationAuthorization ?? '').trim();

	let body: IDataObject = {
		source_system: this.getNodeParameter('sourceSystem', i, 'n8n') as string,
		external_id: this.getNodeParameter('externalId', i) as string,
		contractual_loader: party(loader),
		effective_carrier: party(carrier),
		origin: place(origin),
		destination: place(destination),
		goods: goods.map((line) => compact({ description: line.description, weight_kg: line.weightKg === '' ? undefined : String(line.weightKg) })),
		transport_date: this.getNodeParameter('transportDate', i) as string,
		vehicle: compact({
			configuration,
			motor_plate: vehicle.motorPlate,
			motor_country: vehicle.motorCountry,
			trailer_plate: trailerPlate === '' ? undefined : trailerPlate,
			trailer_country: trailerPlate === '' ? undefined : vehicle.trailerCountry,
		}),
		special_circulation_authorization_required: authorization !== '',
		special_circulation_authorization: authorization !== '' ? { identifier: authorization } : null,
		regulatory_profile: 'deca_basic',
		cargo_scope_declaration: (this.getNodeParameter('ordinaryGoodsConfirmed', i, true) as boolean) ? 'ordinary_confirmed' : 'special_or_unknown',
		...compact({
			observations: additional.observations,
			driver_name: additional.driverName,
			driver_id_number: additional.driverIdNumber,
			internal_reference: additional.internalReference,
			run_id: additional.runId,
		}),
	};

	if (body.contractual_loader === undefined) {
		delete body.contractual_loader;
	}

	const raw = additional.rawJson;

	if (raw !== undefined && raw !== '' && raw !== '{}') {
		const parsed = typeof raw === 'string' ? (JSON.parse(raw) as IDataObject) : (raw as IDataObject);
		body = { ...body, ...parsed };
	}

	return decaLegalApiRequest.call(this, 'POST', '/shipments', body, undefined, {
		headers: { 'Idempotency-Key': idempotencyKey.call(this, i, additional.idempotencyKey as string | undefined) },
	});
}

async function issueDocument(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const documentId = this.getNodeParameter('documentId', i) as string;
	const document = await decaLegalApiRequest.call(this, 'GET', `/documents/${encodeURIComponent(documentId)}`);
	const draft = document.active_draft as IDataObject | null | undefined;

	if (!draft || !draft.id) {
		throw new NodeOperationError(this.getNode(), `The document ${documentId} has no draft to issue; it may already be published.`, { itemIndex: i });
	}

	let operation = await decaLegalApiRequest.call(this, 'POST', `/documents/${encodeURIComponent(documentId)}/issue`, {
		draft_id: draft.id,
		draft_revision: draft.revision,
	}, undefined, { headers: { 'Idempotency-Key': idempotencyKey.call(this, i) } });

	if (this.getNodeParameter('wait', i, true) as boolean) {
		operation = await waitForOperation.call(this, String(operation.id), this.getNodeParameter('timeout', i, 120) as number);

		if (operation.status === 'failed') {
			throw new NodeOperationError(this.getNode(), `Issuing the document ${documentId} failed: ${JSON.stringify(operation.error ?? operation)}`, { itemIndex: i });
		}
	}

	return { ...operation, document_id: documentId };
}

async function uploadImport(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
	const binary = this.helpers.assertBinaryData(i, binaryProperty);
	const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
	const mappingId = this.getNodeParameter('mappingId', i, '') as string;
	const form = new FormData();

	form.append('kind', this.getNodeParameter('kind', i) as string);

	if (mappingId !== '') {
		form.append('mapping_id', mappingId);
	}

	form.append('file', new Blob([new Uint8Array(buffer)], { type: binary.mimeType || 'application/octet-stream' }), binary.fileName ?? 'file');

	return decaLegalApiRequest.call(this, 'POST', '/imports', form as unknown as IDataObject, undefined, {
		headers: { 'Idempotency-Key': idempotencyKey.call(this, i) },
	});
}

function party(fields: IDataObject): IDataObject | undefined {
	const value = compact({
		legal_name: fields.legalName,
		tax_id: fields.taxId,
		tax_country: fields.taxCountry,
		address: address(fields),
	});

	return Object.keys(value).length > 0 ? value : undefined;
}

function place(fields: IDataObject): IDataObject {
	return compact({
		label: fields.label,
		country: fields.country,
		address: address(fields),
	});
}

function address(fields: IDataObject): IDataObject | undefined {
	const value = compact({
		line1: fields.addressLine1,
		postal_code: fields.addressPostalCode,
		locality: fields.addressLocality,
		province: fields.addressProvince,
	});

	return Object.keys(value).length > 0 ? value : undefined;
}
