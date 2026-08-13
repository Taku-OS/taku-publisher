export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface PublisherOutput extends JsonObject {
  schema_version: string;
  ok: boolean;
  status: string;
  requires_action: boolean;
}

export interface PublisherState extends JsonObject {
  draft_id: string;
  status: string;
  mode: string;
  source_path: string;
  unit: JsonObject;
}

export interface FileManifestEntry extends JsonObject {
  path: string;
  size: number;
  sha256: string;
}
