import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type ApiContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

/**
 * Calls the DecaLegal API with the configured credential. Errors keep the
 * machine-readable code DecaLegal returns (error.code) so workflows can
 * branch on it.
 */
export async function decaLegalApiRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	extra?: Partial<IHttpRequestOptions>,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('decaLegalApi');
	const baseUrl = String(credentials.baseUrl ?? 'https://deca.legal/api/v1').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
		headers: { Accept: 'application/json' },
		...(body !== undefined ? { body } : {}),
		...(qs !== undefined ? { qs } : {}),
		...extra,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(this, 'decaLegalApi', options);

		return (response ?? {}) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as never, {
			message: apiErrorMessage(error),
		});
	}
}

/**
 * Idempotency key for the operations that require one: the same n8n
 * execution retrying the same item never creates the same thing twice.
 */
export function idempotencyKey(this: IExecuteFunctions, itemIndex: number, override?: string): string {
	const key = override && override.trim() !== '' ? override.trim() : `n8n-${this.getWorkflow().id ?? 'wf'}-${this.getExecutionId()}-${itemIndex}`;

	return key.length >= 16 ? key.slice(0, 128) : key.padEnd(16, '0');
}

/**
 * Waits until an asynchronous operation (issuing a document) finishes.
 */
export async function waitForOperation(
	this: IExecuteFunctions,
	operationId: string,
	timeoutSeconds: number,
): Promise<IDataObject> {
	const deadline = Date.now() + timeoutSeconds * 1000;
	let operation: IDataObject = {};

	while (Date.now() < deadline) {
		operation = await decaLegalApiRequest.call(this, 'GET', `/operations/${operationId}`);

		if (operation.status === 'succeeded' || operation.status === 'failed') {
			return operation;
		}

		await sleep(2000);
	}

	throw new NodeOperationError(this.getNode(), `The operation ${operationId} did not finish in ${timeoutSeconds} seconds; its last status was "${String(operation.status ?? 'unknown')}".`);
}

/**
 * Verifies the signature DecaLegal puts on every webhook delivery:
 * X-Deca-Signature = v1=HMAC-SHA256("<timestamp>.<raw body>", secret).
 */
export function webhookSignatureIsValid(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
	const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
	const a = Buffer.from(expected);
	const b = Buffer.from(signature);

	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Removes undefined and empty-string values so optional fields are left
 * out of the request instead of being sent as blanks.
 */
export function compact(object: IDataObject): IDataObject {
	const result: IDataObject = {};

	for (const [key, value] of Object.entries(object)) {
		if (value === undefined || value === null || value === '') {
			continue;
		}

		if (typeof value === 'object' && !Array.isArray(value)) {
			const nested = compact(value as IDataObject);

			if (Object.keys(nested).length > 0) {
				result[key] = nested;
			}

			continue;
		}

		result[key] = value;
	}

	return result;
}

function apiErrorMessage(error: unknown): string {
	const response = (error as { response?: { body?: { error?: { code?: string; message?: string; fields?: Array<{ path?: string; message?: string }> } } } }).response;
	const body = response?.body?.error;

	if (!body) {
		return (error as Error).message ?? 'DecaLegal request failed';
	}

	const fields = (body.fields ?? []).map((field) => `${field.path ?? ''}: ${field.message ?? ''}`).join('; ');

	return `${body.code ?? 'error'}: ${body.message ?? ''}${fields ? ` (${fields})` : ''}`;
}
