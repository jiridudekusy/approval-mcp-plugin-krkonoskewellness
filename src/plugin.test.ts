import { describe, expect, it, vi } from 'vitest';

import { validatePluginDescription } from './sdk/validate-output.js';

import {
  CONNECTED_TOOL_DEFINITIONS,
  ConnectedApprovalPlugin,
  connectedApprovalPlugins,
  type ConnectedPluginId,
} from './plugin.js';

function input(toolName: string, args: Record<string, unknown> = {}) {
  return {
    upstreamId: 'upstream-1',
    upstreamAlias: 'connected',
    toolName,
    arguments: args as Record<string, string | boolean | number>,
  };
}

describe('connected approval plugins', () => {

  it('validates every supported tool presentation', async () => {
    expect(connectedApprovalPlugins().map((plugin) => plugin.id)).toEqual([
      'krkonoskewellness',
    ]);
    for (const [id, definitions] of Object.entries(CONNECTED_TOOL_DEFINITIONS)) {
      const plugin = new ConnectedApprovalPlugin(id as ConnectedPluginId);
      for (const name of Object.keys(definitions)) {
        const result = validatePluginDescription(await plugin.describe(input(name)));
        expect(result.source).toBe('plugin');
        expect(result.title.fallback.en).toBeTruthy();
        expect(result.title.fallback.cs).toBeTruthy();
      }
    }
  });

  it('shows every supplied parameter in the readable request section across all connected plugins', async () => {
    for (const [id, definitions] of Object.entries(CONNECTED_TOOL_DEFINITIONS)) {
      const plugin = new ConnectedApprovalPlugin(id as ConnectedPluginId);
      for (const toolName of Object.keys(definitions)) {
        const result = await plugin.describe(input(toolName, {
          page: 3, offset: 40, limit: 20, futureFlag: true,
        }));
        const fields = result.sections.find((section) => section.id === 'request')?.fields ?? [];
        for (const [key, value] of Object.entries({ page: 3, offset: 40, limit: 20, futureFlag: true })) {
          expect(fields, `${id}.${toolName} omits ${key}`).toContainEqual(
            expect.objectContaining({ value }),
          );
        }
      }
    }
  });

  it('distinguishes wellness dry run from a binding booking and offers no reusable scope', async () => {
    const plugin = new ConnectedApprovalPlugin('krkonoskewellness');
    const args = { service_id: 42, start: '2026-10-15T14:30', note: 'Pokoj 5' };
    const preview = await plugin.describe(input('book', args));
    const booking = await plugin.describe(input('book', { ...args, confirm: true }));

    expect(preview.sections[0]?.risk).toBe('info');
    expect(preview.title.fallback.en).toContain('Preview');
    expect(booking.sections[0]?.risk).toBe('danger');
    expect(booking.title.params?.['target']).toBe('#42');
    expect(booking.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'Pokoj 5' }),
      expect.objectContaining({ value: true }),
    ]));
    expect(booking.proposedScopes).toEqual([]);
  });

  it('resolves wellness service and therapist names by exact ID without hiding the IDs', async () => {
    const listWellnessServices = vi.fn().mockResolvedValue({
      content: [{ text: JSON.stringify({ services: [
        { id: 62431, name: 'Relaxacni masaz', therapists: [
          { id: 111, name: 'Jina maserka' }, { id: 44952, name: 'Alena' },
        ] },
        { id: 98765, name: 'Jina sluzba' },
      ] }) }],
    });
    const plugin = new ConnectedApprovalPlugin('krkonoskewellness', {
      findContact: vi.fn(), listWellnessServices,
    });
    const result = await plugin.describe(input('book', {
      service_id: 62431, therapist_id: 44952, start: '2026-10-17T20:00', confirm: true,
    }));

    expect(listWellnessServices).toHaveBeenCalledWith('upstream-1');
    expect(result.title.params?.['target']).toBe('Relaxacni masaz');
    expect(result.title.fallback.cs).toBe('Rezervace: {target}');
    expect(result.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: { id: 62431, name: 'Relaxacni masaz' } }),
      expect.objectContaining({ value: { id: 44952, name: 'Alena' } }),
    ]));
    expect(result.sections[1]?.fields[0]?.value).toMatchObject({ service_id: 62431, therapist_id: 44952 });
  });

  it('keeps wellness IDs when catalog lookup fails or does not match exactly', async () => {
    const plugin = new ConnectedApprovalPlugin('krkonoskewellness', {
      findContact: vi.fn(),
      listWellnessServices: vi.fn().mockResolvedValue({ services: [
        { id: 624310, name: 'Wrong service', therapists: [{ id: 449520, name: 'Wrong therapist' }] },
      ] }),
    });
    const result = await plugin.describe(input('book', {
      service_id: 62431, therapist_id: 44952, start: '2026-10-17T20:00', confirm: true,
    }));
    expect(result.sections[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: { id: 62431, name: null } }),
      expect.objectContaining({ value: { id: 44952, name: null } }),
    ]));
    expect(result.title.params?.['target']).toBe('#62431');
  });

});

