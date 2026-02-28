// mdclaw contract harness: parses anchor contracts into structured data for generated tests
// This is real shipped code (like integration.test.ts) — the stable foundation for contract-derived tests.

import { readFileSync } from 'node:fs';

// --- Types ---

export interface InterfaceField {
  name: string;
  type: string;
  optional: boolean;
}

export interface ParsedInterface {
  name: string;
  fields: InterfaceField[];
}

export interface ParsedColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ParsedTable {
  tableName: string;
  columns: ParsedColumn[];
  checks: string[];
  indices: string[];
}

export interface ParsedIpcCommand {
  type: string;
  payloadFields: string[];
  mainGroupOnly: boolean;
}

export interface ParsedTransition {
  from: string;
  to: string;
  condition: string;
}

export interface ParsedStateMachine {
  states: string[];
  transitions: ParsedTransition[];
}

// --- Parsers ---

/**
 * Parse types-contract.ts into structured interface definitions.
 * Extracts `export interface` blocks and `export type` aliases.
 */
export function parseTypesContract(path: string): ParsedInterface[] {
  const src = readFileSync(path, 'utf8');
  const interfaces: ParsedInterface[] = [];

  // Match export interface blocks (handles nested braces by counting)
  const interfaceRegex = /export interface (\w+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(src)) !== null) {
    const name = match[1];
    const startBrace = match.index + match[0].length - 1;
    let depth = 1;
    let pos = startBrace + 1;

    while (depth > 0 && pos < src.length) {
      if (src[pos] === '{') depth++;
      else if (src[pos] === '}') depth--;
      pos++;
    }

    const body = src.slice(startBrace + 1, pos - 1);
    const fields: InterfaceField[] = [];

    // Parse each field line — handles method signatures too
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      // Method signature: name(args): ReturnType;
      const methodMatch = trimmed.match(/^(\w+)(\??)\s*\(.*\).*:\s*(.+);?\s*$/);
      if (methodMatch) {
        fields.push({
          name: methodMatch[1],
          type: `method:${methodMatch[3].replace(/;$/, '').trim()}`,
          optional: methodMatch[2] === '?',
        });
        continue;
      }

      // Property: name?: Type;
      const propMatch = trimmed.match(/^(\w+)(\??)\s*:\s*(.+);?\s*$/);
      if (propMatch) {
        fields.push({
          name: propMatch[1],
          type: propMatch[3].replace(/;$/, '').trim(),
          optional: propMatch[2] === '?',
        });
      }
    }

    interfaces.push({ name, fields });
  }

  return interfaces;
}

/**
 * Parse schema.sql into structured table definitions.
 * Extracts CREATE TABLE, CHECK constraints, and CREATE INDEX statements.
 */
export function parseSchemaContract(path: string): ParsedTable[] {
  const src = readFileSync(path, 'utf8');
  const tables: ParsedTable[] = [];

  // Match CREATE TABLE blocks
  const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(src)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: ParsedColumn[] = [];
    const checks: string[] = [];

    for (const line of body.split('\n')) {
      const trimmed = line.trim().replace(/,\s*$/, '');
      if (!trimmed || trimmed.startsWith('--')) continue;

      // Skip FOREIGN KEY lines
      if (trimmed.startsWith('FOREIGN KEY')) continue;

      // Column definition
      const colMatch = trimmed.match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB)(.*)$/i);
      if (colMatch) {
        const colName = colMatch[1];
        const colType = colMatch[2].toUpperCase();
        const rest = colMatch[3];
        const nullable = !rest.includes('NOT NULL') && !rest.includes('PRIMARY KEY');

        // Extract inline CHECK constraints
        const checkMatch = rest.match(/CHECK\s*\(([^)]+)\)/i);
        if (checkMatch) {
          checks.push(`${colName}:${checkMatch[1].trim()}`);
        }

        columns.push({ name: colName, type: colType, nullable });
      }
    }

    // Find indices for this table
    const indexRegex = new RegExp(`CREATE INDEX IF NOT EXISTS (\\w+) ON ${tableName}\\(([^)]+)\\)`, 'g');
    const indices: string[] = [];
    let idxMatch: RegExpExecArray | null;
    while ((idxMatch = indexRegex.exec(src)) !== null) {
      indices.push(idxMatch[1]);
    }

    tables.push({ tableName, columns, checks, indices });
  }

  return tables;
}

/**
 * Parse ipc-protocol.md into structured command definitions.
 * Extracts command types, their payload fields, and auth requirements.
 */
export function parseIpcContract(path: string): ParsedIpcCommand[] {
  const src = readFileSync(path, 'utf8');
  const commands: ParsedIpcCommand[] = [];

  // Find the "Command types" section
  const commandSection = src.split('## Command types')[1];
  if (!commandSection) return commands;

  // Split by ### to get each command
  const sections = commandSection.split(/^### /m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split('\n');
    const typeLine = lines[0]?.trim();
    if (!typeLine) continue;

    // Command type is the first word (e.g., "schedule_task")
    const type = typeLine.split(/\s/)[0];
    if (!type || type.startsWith('#')) continue;

    // Check for "Main group only" marker
    const mainGroupOnly = section.includes('**Main group only**') || section.includes('Main group only');

    // Extract payload fields from the bullet list
    const payloadFields: string[] = [];
    const fieldRegex = /^- `(\w+)`/gm;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(section)) !== null) {
      payloadFields.push(fieldMatch[1]);
    }

    commands.push({ type, payloadFields, mainGroupOnly });
  }

  return commands;
}

/**
 * Parse state-machine.md into states and transitions.
 * Extracts state names and transition rules.
 */
export function parseStateMachineContract(path: string): ParsedStateMachine {
  const src = readFileSync(path, 'utf8');

  // Extract states from ### headings under ## States
  const states: string[] = [];
  const stateRegex = /^### (\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = stateRegex.exec(src)) !== null) {
    states.push(match[1]);
  }

  // Extract transitions from "**Transitions:**" blocks
  const transitions: ParsedTransition[] = [];
  const transitionBlockRegex = /### (\w+)[\s\S]*?\*\*Transitions:\*\*([\s\S]*?)(?=\n### |\n## |$)/g;

  while ((match = transitionBlockRegex.exec(src)) !== null) {
    const fromState = match[1];
    const block = match[2];

    // Each transition line: "- condition → STATE"
    const lineRegex = /^- (.+?)→\s*(\w+)/gm;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const condition = lineMatch[1].trim().replace(/\s+$/, '');
      const toState = lineMatch[2];
      transitions.push({ from: fromState, to: toState, condition });
    }
  }

  return { states, transitions };
}
