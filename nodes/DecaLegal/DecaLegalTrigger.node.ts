import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { decaLegalApiRequest, webhookSignatureIsValid } from './GenericFunctions';

const EVENTS = [
	{ name: 'Document Published', value: 'document.published', description: 'A DeCA was issued and its PDF and QR are available' },
	{ name: 'Document Superseded', value: 'document.superseded', description: 'A new version replaced the current one' },
	{ name: 'Document Public Access Expired', value: 'document.public_access_expired', description: 'The public inspection link of a version was closed' },
	{ name: 'Document Timestamp Verified', value: 'document.timestamp_verified', description: 'The timestamp proof of a version was verified' },
	{ name: 'Import Review Required', value: 'import.review_required', description: 'An uploaded file was read and needs a human review' },
	{ name: 'Import Failed', value: 'import.failed', description: 'An uploaded file could not be read' },
	{ name: 'Driver Document Acknowledged', value: 'driver.document_acknowledged', description: 'The driver received the document on their device' },
];

export class DecaLegalTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DecaLegal Trigger',
		name: 'decaLegalTrigger',
		icon: 'file:decalegal.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["events"].join(", ") }}',
		description: 'Starts the workflow when DecaLegal publishes a DeCA, reads an uploaded file or the driver acknowledges a document',
		defaults: { name: 'DecaLegal Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'decaLegalApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENTS,
				default: ['document.published'],
				required: true,
				description: 'Which DecaLegal events start this workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;

				if (!webhookId) {
					return false;
				}

				try {
					await decaLegalApiRequest.call(this, 'GET', `/webhooks/${webhookId}`);

					return true;
				} catch {
					delete staticData.webhookId;
					delete staticData.webhookSecret;

					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const url = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events') as string[];
				const body: IDataObject = { url, events, description: `n8n: ${this.getWorkflow().name ?? 'workflow'}` };

				let endpoint = await decaLegalApiRequest.call(this, 'POST', '/webhooks', body);

				// The same URL registered before this n8n instance forgot its secret:
				// replace it so the signature can be verified again.
				if (!endpoint.secret && endpoint.id) {
					await decaLegalApiRequest.call(this, 'DELETE', `/webhooks/${String(endpoint.id)}`);
					endpoint = await decaLegalApiRequest.call(this, 'POST', '/webhooks', body);
				}

				staticData.webhookId = endpoint.id;
				staticData.webhookSecret = endpoint.secret;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;

				if (webhookId) {
					try {
						await decaLegalApiRequest.call(this, 'DELETE', `/webhooks/${webhookId}`);
					} catch {
						// Already gone on the DecaLegal side.
					}
				}

				delete staticData.webhookId;
				delete staticData.webhookSecret;

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const staticData = this.getWorkflowStaticData('node');
		const secret = staticData.webhookSecret as string | undefined;
		const timestamp = String(request.headers['x-deca-timestamp'] ?? '');
		const signature = String(request.headers['x-deca-signature'] ?? '');
		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});

		if (!secret || !webhookSignatureIsValid(secret, timestamp, rawBody, signature)) {
			response.status(401).json({ error: 'invalid_signature' });

			return { noWebhookResponse: true };
		}

		const events = this.getNodeParameter('events') as string[];
		const body = (this.getBodyData() ?? {}) as IDataObject;

		if (!events.includes(String(body.type ?? ''))) {
			return { workflowData: [[]] };
		}

		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
