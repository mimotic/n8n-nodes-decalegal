# n8n-nodes-decalegal

An [n8n](https://n8n.io) community node for [DecaLegal](https://deca.legal), the Spanish electronic road transport control document (DeCA). Create transports from your orders, issue the DeCA with its custodied PDF and inspection QR, read delivery notes with AI, search your catalogs, and start workflows when a document is published or a driver acknowledges it.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Example](#example) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-decalegal`. The node needs no runtime dependencies.

## Credentials

1. In the DecaLegal portal open **Integraciones** (owner role) and create an integration with the scopes you need: `shipments:read`, `shipments:write`, `documents:read`, `documents:issue`, `transports:complete`, `imports:write` and, for the trigger, `webhooks:manage`.
2. Issue a token for it and paste it in the **DecaLegal API** credential in n8n. The token decides the company the node works in.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Transport | Create | Creates a transport from your order or delivery note data (loader, carrier, origin, destination, goods, vehicle, date). Keeps your `external_id`. |
| Transport | Get / List | Reads one transport or lists them (filter by status or external ID). |
| Transport | Complete | Records the real end of the service, which closes the public inspection window. |
| Document (DeCA) | Create | Prepares a DeCA from one or more transports that share loader and carrier. |
| Document (DeCA) | Issue | Issues the DeCA. By default waits until it is published and returns the version with its PDF, QR and inspection links. |
| Document (DeCA) | Get / Get Operation | Reads a document, or the progress of an issue operation. |
| Import | Upload | Uploads a delivery note (PDF, JPG, PNG, WebP) to read with AI, or an XLSX/CSV. A person reviews the proposal in the portal before anything is issued. |
| Import | Get | Reads an import with its items and issues. |
| Catalog | Search | Finds known companies, places, vehicles or goods so you can reuse their data. |

Write operations send an `Idempotency-Key` derived from the execution, so a retried item never creates the same transport or document twice. You can set your own key in **Additional Fields**.

## Trigger

**DecaLegal Trigger** registers a webhook in your company for the events you choose and verifies every delivery's signature (`X-Deca-Signature`, HMAC-SHA256 of `timestamp.body` with the secret DecaLegal returns when the webhook is created):

- `document.published`: a DeCA was issued; the payload carries the document and version IDs. Use **Document → Get** to fetch the PDF and QR links.
- `document.superseded`, `document.public_access_expired`, `document.timestamp_verified`
- `import.review_required`, `import.failed`
- `driver.document_acknowledged`

The webhook is created when the workflow is activated and deleted when it is deactivated. Each integration only sees and deletes the webhooks it registered.

## Example

ERP order → DeCA, in four nodes:

1. **Trigger** of your choice (a new row in Google Sheets, a webhook from your ERP, a schedule).
2. **DecaLegal → Transport → Create** with the order fields. Keep *Ordinary Goods Confirmed* on when you only move ordinary goods.
3. **DecaLegal → Document → Create** with `{{ $json.id }}`.
4. **DecaLegal → Document → Issue** with `{{ $json.id }}` and *Wait Until Published* on. The output includes the version with `pdf_download_url`, `qr_download_url` and `inspection_url`.

Add a **DecaLegal Trigger** on `driver.document_acknowledged` to update the order when the driver has the document on the cab tablet.

## Compatibility

Tested with n8n 1.80 and later. Requires Node.js 20.15 or later.

## Resources

- [How DecaLegal integrates with your ERP](https://deca.legal/integraciones)
- [Connect DecaLegal to ChatGPT, Claude and other agents (MCP)](https://deca.legal/integraciones/mcp)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
