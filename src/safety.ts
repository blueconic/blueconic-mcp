import type { QueryParamValue } from "./api-client.js";
import type { BulkSafetyLimits } from "./config.js";

export type OperationRisk = "read" | "additive_write" | "destructive_write";

export type OperationSafetyPolicy = {
  maxBatchSize?: number;
  requiresConfirmation: boolean;
  risk: OperationRisk;
};

export type ToolAnnotations = {
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  readOnlyHint: boolean;
};

export type DryRunSummary = {
  confirmationTokenRequired: boolean;
  confirmationTokenUsage?: ConfirmationTokenUsage;
  destructive: boolean;
  dryRun: true;
  estimatedObjectCount: number;
  executed: false;
  maxBatchSize?: number;
  method: string;
  pathParams: Record<string, string>;
  pathTemplate: string;
  queryParams: Record<string, QueryParamValue>;
  requiresConfirmation: boolean;
  resolvedPath: string;
  risk: OperationRisk;
  targetEndpoint: string;
  tenantUrl: string;
  tool: string;
  wouldExceedMaxBatchSize?: boolean;
};

export type ConfirmationTokenUsage = {
  argumentName: "confirmationToken";
  doNotPlaceInside: "requestBody";
  placement: "top-level tool argument";
  siblingOf: "requestBody";
};

export const CONFIRMATION_TOKEN_PLACEMENT_MESSAGE = [
  "Put confirmationToken at the top level of the tool arguments, as a sibling of requestBody.",
  "Do not put confirmationToken inside requestBody."
].join(" ");

const WRITE_TOOL_WARNING = [
  "WARNING: This tool modifies live BlueConic data.",
  "It may create, update, or delete customer/business records.",
  "Confirm the tenant, target identifiers, and expected impact before use."
].join(" ");

const DESTRUCTIVE_TOOL_WARNING = [
  "WARNING: This is a destructive BlueConic write.",
  "Run with dryRun: true before execution.",
  "Execution requires user confirmation or a one-time confirmationToken."
].join(" ");

const WRITE_DRY_RUN_GUIDANCE = "Use dryRun: true to preview the endpoint and estimated object count before writing.";
const BATCH_REQUEST_BODY_KEYS = ["items", "ids", "profiles", "groups", "events", "records", "objects"] as const;

export function isWriteRisk(risk: OperationRisk): boolean {
  return risk !== "read";
}

export function isDestructiveRisk(risk: OperationRisk): boolean {
  return risk === "destructive_write";
}

export function getOperationAnnotations(policy: OperationSafetyPolicy, method: string): ToolAnnotations {
  const methodUpperCase = method.toUpperCase();

  return {
    readOnlyHint: policy.risk === "read",
    destructiveHint: policy.risk === "destructive_write",
    idempotentHint: ["GET", "PUT", "DELETE"].includes(methodUpperCase),
    openWorldHint: false
  };
}

export function buildToolDescription(baseDescription: string, policy: OperationSafetyPolicy): string {
  if (!isWriteRisk(policy.risk)) {
    return baseDescription;
  }

  const warning = policy.risk === "destructive_write"
    ? `${WRITE_TOOL_WARNING}\n${DESTRUCTIVE_TOOL_WARNING}`
    : `${WRITE_TOOL_WARNING}\n${WRITE_DRY_RUN_GUIDANCE}`;

  return `${warning}\n\n${baseDescription}`;
}

export function estimateObjectCount(
  requestBody: unknown,
  queryParams: Record<string, QueryParamValue> = {}
): number {
  const requestBodyCount = estimateRequestBodyObjectCount(requestBody);
  if (requestBodyCount !== undefined) {
    return requestBodyCount;
  }

  const queryParamArray = Object.values(queryParams).find(Array.isArray);
  return queryParamArray ? queryParamArray.length : 1;
}

export function getEffectiveMaxBatchSize(
  policy: OperationSafetyPolicy,
  limits: BulkSafetyLimits
): number | undefined {
  if (!isWriteRisk(policy.risk)) {
    return undefined;
  }

  const environmentLimit = policy.risk === "destructive_write"
    ? Math.min(limits.maxBulkItems, limits.maxDestructiveBulkItems)
    : limits.maxBulkItems;

  return policy.maxBatchSize === undefined
    ? environmentLimit
    : Math.min(policy.maxBatchSize, environmentLimit);
}

export function buildDryRunSummary(params: {
  estimatedObjectCount: number;
  finalPath: string;
  maxBatchSize?: number;
  method: string;
  path: string;
  pathParams: Record<string, string>;
  policy: OperationSafetyPolicy;
  queryParams: Record<string, QueryParamValue>;
  targetEndpoint: string;
  tenantUrl: string;
  toolName: string;
}): DryRunSummary {
  const wouldExceedMaxBatchSize = params.maxBatchSize === undefined
    ? undefined
    : params.estimatedObjectCount > params.maxBatchSize;

  return {
    dryRun: true,
    executed: false,
    tool: params.toolName,
    tenantUrl: params.tenantUrl,
    method: params.method,
    targetEndpoint: params.targetEndpoint,
    pathTemplate: params.path,
    resolvedPath: params.finalPath,
    pathParams: params.pathParams,
    queryParams: params.queryParams,
    estimatedObjectCount: params.estimatedObjectCount,
    ...(params.maxBatchSize === undefined ? {} : { maxBatchSize: params.maxBatchSize }),
    ...(wouldExceedMaxBatchSize === undefined ? {} : { wouldExceedMaxBatchSize }),
    risk: params.policy.risk,
    destructive: params.policy.risk === "destructive_write",
    requiresConfirmation: params.policy.requiresConfirmation,
    confirmationTokenRequired: params.policy.requiresConfirmation,
    ...(params.policy.requiresConfirmation
      ? { confirmationTokenUsage: getConfirmationTokenUsage() }
      : {})
  };
}

export function getConfirmationTokenUsage(): ConfirmationTokenUsage {
  return {
    argumentName: "confirmationToken",
    placement: "top-level tool argument",
    siblingOf: "requestBody",
    doNotPlaceInside: "requestBody"
  };
}

export function getMisplacedConfirmationToken(requestBody: unknown): string | undefined {
  if (!isPlainObject(requestBody) || typeof requestBody.confirmationToken !== "string") {
    return undefined;
  }

  return requestBody.confirmationToken;
}

function estimateRequestBodyObjectCount(requestBody: unknown): number | undefined {
  if (Array.isArray(requestBody)) {
    return requestBody.length;
  }

  if (!isPlainObject(requestBody)) {
    return undefined;
  }

  for (const key of BATCH_REQUEST_BODY_KEYS) {
    const candidateValue = requestBody[key];
    if (Array.isArray(candidateValue)) {
      return candidateValue.length;
    }
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
