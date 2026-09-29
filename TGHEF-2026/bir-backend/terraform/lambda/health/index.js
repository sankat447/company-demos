/**
 * AppSync health resolver target — proves the deployed API + Lambda data source
 * are wired end-to-end (deploy.sh smoke test hits this). Returns a static ok.
 */
'use strict';
exports.handler = async () => ({ ok: true, service: 'bir-festival-2026', ts: Date.now() });
