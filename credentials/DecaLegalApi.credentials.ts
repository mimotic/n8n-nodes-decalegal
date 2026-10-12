import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DecaLegalApi implements ICredentialType {
	name = 'decaLegalApi';

	displayName = 'DecaLegal API';

	documentationUrl = 'https://deca.legal/integraciones';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://deca.legal/api/v1',
			description: 'Leave the default unless DecaLegal gave you another address',
		},
		{
			displayName: 'Integration Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Create it in the DecaLegal portal under Integrations. It determines the company and the scopes the node can use.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/me',
		},
	};
}
