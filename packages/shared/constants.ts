/**
 * Hermes Home — shared constants.
 */

export const SERVER_NAME = 'hermes-home';
export const SERVER_VERSION = '0.1.0';

/** Default local endpoints. Override via env in real deployments. */
export const DEFAULT_PORT = 3000;
export const DEFAULT_HERMES_API_URL = 'http://127.0.0.1:8642';

/** Env var names — kept here so nothing invents a second spelling. */
export const ENV = {
  PORT: 'PORT',
  PUBLIC_BASE_URL: 'PUBLIC_BASE_URL',
  HERMES_API_URL: 'HERMES_API_URL',
  HERMES_API_KEY: 'HERMES_API_KEY',
  HERMES_MCP_CONFIG: 'HERMES_MCP_CONFIG',
  AUTH_MODE: 'AUTH_MODE', // 'local' | 'oauth2'
  AUTH_ISSUER: 'AUTH_ISSUER',
  AUTH_AUDIENCE: 'AUTH_AUDIENCE',
  AUTH_JWKS_URI: 'AUTH_JWKS_URI',
  HASS_URL: 'HASS_URL',
  HASS_TOKEN: 'HASS_TOKEN',
} as const;
