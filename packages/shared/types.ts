/**
 * Hermes Home — shared domain types.
 *
 * These types intentionally normalise the outside world for Alexa+.
 * Do NOT expose raw Hermes/Home-Assistant database shapes through MCP —
 * map them into these structures first (see spec §25).
 */

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Normalised personal context returned to Alexa+ (spec §25). */
export type PersonalContext = {
  userId: string;
  preferences?: Preference[];
  activeProjects?: Project[];
  recentMemories?: Memory[];
  home?: HomeContext;
  integrations?: IntegrationState[];
};

export type Preference = {
  key: string;
  value: string;
  updatedAt?: string;
};

export type Project = {
  id: string;
  name: string;
  status?: string;
  summary?: string;
};

export type Memory = {
  id: string;
  content: string;
  source?: string;
  createdAt?: string;
  relevance?: number;
};

export type HomeContext = {
  devicesOnline?: number;
  devicesTotal?: number;
  rooms?: string[];
};

export type IntegrationState = {
  id: string;
  name: string;
  connected: boolean;
  detail?: string;
};

/** Result envelope every MCP tool should return (spec §27). */
export type ToolResult<T> = {
  success: boolean;
  error?: string;
} & T;

/** A normalized device state for the generic hardware adapter (spec §45). */
export type DeviceState = Record<string, unknown>;

export interface DeviceContextProvider {
  id: string;
  getState(): Promise<DeviceState>;
}

/** Pluggable integration contract (spec §4D). */
export interface Integration {
  id: string;
  name: string;
  healthCheck(): Promise<boolean>;
  tools(): ToolDefinition[];
}

/**
 * Minimal tool-definition shape shared across the repo.
 * The MCP server converts these into MCP tool registrations and
 * Hermes-side registrations.
 */
export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** JSON Schema (draft 2020-12) for the tool's input. */
  inputSchema: Record<string, unknown>;
};
