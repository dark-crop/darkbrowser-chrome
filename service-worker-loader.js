// Load shared provider registry first.
import './provider-registry.js';
// Load API adapter first to intercept fetch calls
import './api-adapter.js';
// Load auth bypass to mock profile/OAuth API calls
import './auth-bypass.js';
// Load provider config to initialize settings and bypass auth
import './provider-config.js';
// Load the original service worker
import './assets/service-worker.ts-3CRyLSDu.js';
