import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getMcpContext } from '@/lib/mcp/context';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

const getDb = () => createStaticAdminClient();

function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

export function registerAdminTools(server: McpServer) {
  // ─── crm.admin.users.list ─────────────────────────────────────────────────
  server.registerTool(
    'crm.admin.users.list',
    {
      title: 'List team members',
      description:
        'Read-only. Lists all team members (profiles) for the authenticated organization. Returns id, email, full_name, role, avatar_url, created_at.',
      inputSchema: {},
    },
    async () => {
      const ctx = getMcpContext();
      const { data, error } = await getDb()
        .from('profiles')
        .select('id, email, full_name, role, avatar_url, created_at')
        .eq('organization_id', ctx.organizationId)
        .order('created_at', { ascending: true });

      if (error) return err(error.message);
      return ok(data);
    }
  );

  // ─── crm.admin.invites.list ───────────────────────────────────────────────
  server.registerTool(
    'crm.admin.invites.list',
    {
      title: 'List pending invites',
      description:
        'Read-only. Lists team invites for the authenticated organization. Optionally filter by status (defaults to all statuses).',
      inputSchema: {
        status: z.enum(['pending', 'accepted', 'expired']).optional(),
      },
    },
    async (args) => {
      const ctx = getMcpContext();

      let query = getDb()
        .from('invites')
        .select('id, email, role, status, invited_by, created_at')
        .eq('organization_id', ctx.organizationId)
        .order('created_at', { ascending: false });

      if (args.status) query = query.eq('status', args.status);

      const { data, error } = await query;
      if (error) return err(error.message);
      return ok(data);
    }
  );

  // ─── crm.admin.invites.create ─────────────────────────────────────────────
  server.registerTool(
    'crm.admin.invites.create',
    {
      title: 'Create invite',
      description:
        'Writes data. Creates a team invite for the given email address with a specified role. Sets status to "pending" and records the inviting user. Scoped to the authenticated organization.',
      inputSchema: {
        email: z.string().email(),
        role: z.enum(['admin', 'member']),
      },
    },
    async (args) => {
      const ctx = getMcpContext();

      // Check if there is already a pending invite for this email
      const { data: existing, error: lookupError } = await getDb()
        .from('invites')
        .select('id, status')
        .eq('organization_id', ctx.organizationId)
        .eq('email', args.email)
        .eq('status', 'pending')
        .maybeSingle();

      if (lookupError) return err(lookupError.message);
      if (existing) return err(`A pending invite already exists for ${args.email}`);

      const { data: invite, error: insertError } = await getDb()
        .from('invites')
        .insert({
          organization_id: ctx.organizationId,
          email: args.email,
          role: args.role,
          status: 'pending',
          invited_by: ctx.userId,
        })
        .select('id, email, role, status, invited_by, created_at')
        .maybeSingle();

      if (insertError) return err(insertError.message);
      return ok(invite);
    }
  );

  // ─── crm.admin.invites.cancel ─────────────────────────────────────────────
  server.registerTool(
    'crm.admin.invites.cancel',
    {
      title: 'Cancel invite',
      description:
        'Writes data. Cancels (deletes) a pending invite by ID. Only pending invites can be cancelled. Scoped to the authenticated organization.',
      inputSchema: {
        inviteId: z.string().uuid(),
      },
    },
    async (args) => {
      const ctx = getMcpContext();

      // Verify invite belongs to this org and is still pending
      const { data: invite, error: lookupError } = await getDb()
        .from('invites')
        .select('id, status')
        .eq('id', args.inviteId)
        .eq('organization_id', ctx.organizationId)
        .maybeSingle();

      if (lookupError) return err(lookupError.message);
      if (!invite) return err('Invite not found or access denied');
      if (invite.status !== 'pending') return err(`Cannot cancel invite with status "${invite.status}" — only pending invites can be cancelled`);

      const { error: deleteError } = await getDb()
        .from('invites')
        .delete()
        .eq('id', args.inviteId)
        .eq('organization_id', ctx.organizationId);

      if (deleteError) return err(deleteError.message);
      return ok({ cancelled: true, inviteId: args.inviteId });
    }
  );

  // ─── crm.settings.ai.get ─────────────────────────────────────────────────
  server.registerTool(
    'crm.settings.ai.get',
    {
      title: 'Get AI settings',
      description:
        'Read-only. Returns AI configuration for the authenticated organization. API keys are never returned — only boolean flags (hasGoogleKey, hasOpenAIKey, hasAnthropicKey) indicate whether keys are configured.',
      inputSchema: {},
    },
    async () => {
      const ctx = getMcpContext();

      const { data, error } = await getDb()
        .from('organization_settings')
        .select(
          'id, organization_id, ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key, ai_auto_respond, ai_qualification_mode, ai_template_id, hitl_threshold'
        )
        .eq('organization_id', ctx.organizationId)
        .maybeSingle();

      if (error) return err(error.message);
      if (!data) return err('Organization settings not found');

      // Mask API keys — never return the actual values
      const { ai_google_key, ai_openai_key, ai_anthropic_key, ...safe } = data;
      const result = {
        ...safe,
        hasGoogleKey: !!ai_google_key,
        hasOpenAIKey: !!ai_openai_key,
        hasAnthropicKey: !!ai_anthropic_key,
      };

      return ok(result);
    }
  );

  // ─── crm.settings.ai.update ───────────────────────────────────────────────
  server.registerTool(
    'crm.settings.ai.update',
    {
      title: 'Update AI settings',
      description:
        'Writes data. Updates non-sensitive AI configuration fields. API keys cannot be updated via MCP — use the web UI for key management. Scoped to the authenticated organization.',
      inputSchema: {
        ai_enabled: z.boolean().optional(),
        ai_provider: z.string().optional(),
        ai_model: z.string().optional(),
        ai_auto_respond: z.boolean().optional(),
        ai_qualification_mode: z
          .enum(['zero_config', 'template', 'auto_learn', 'advanced'])
          .optional(),
        ai_template_id: z.string().uuid().nullable().optional(),
        hitl_threshold: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      const ctx = getMcpContext();

      // Build update payload from only provided fields
      const updates: Record<string, unknown> = {};
      if (args.ai_enabled !== undefined) updates.ai_enabled = args.ai_enabled;
      if (args.ai_provider !== undefined) updates.ai_provider = args.ai_provider;
      if (args.ai_model !== undefined) updates.ai_model = args.ai_model;
      if (args.ai_auto_respond !== undefined) updates.ai_auto_respond = args.ai_auto_respond;
      if (args.ai_qualification_mode !== undefined) updates.ai_qualification_mode = args.ai_qualification_mode;
      if (args.ai_template_id !== undefined) updates.ai_template_id = args.ai_template_id;
      if (args.hitl_threshold !== undefined) updates.hitl_threshold = args.hitl_threshold;

      if (Object.keys(updates).length === 0) return err('No fields provided to update');

      const { data, error } = await getDb()
        .from('organization_settings')
        .update(updates)
        .eq('organization_id', ctx.organizationId)
        .select(
          'id, organization_id, ai_enabled, ai_provider, ai_model, ai_auto_respond, ai_qualification_mode, ai_template_id, hitl_threshold'
        )
        .maybeSingle();

      if (error) return err(error.message);
      if (!data) return err('Organization settings not found');
      return ok(data);
    }
  );

  // ─── crm.settings.ai_templates.list ──────────────────────────────────────
  server.registerTool(
    'crm.settings.ai_templates.list',
    {
      title: 'List AI qualification templates',
      description:
        'Read-only. Lists AI qualification templates available to the authenticated organization. Includes both system-wide templates (organization_id IS NULL) and org-specific custom templates.',
      inputSchema: {
        methodology: z
          .enum(['bant', 'spin', 'meddic', 'gpct', 'simple'])
          .optional(),
      },
    },
    async (args) => {
      const ctx = getMcpContext();

      // Fetch system templates (organization_id IS NULL) and org-specific ones
      let query = getDb()
        .from('ai_qualification_templates')
        .select('id, organization_id, name, methodology, stages, is_system, created_at')
        .or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)
        .order('is_system', { ascending: false })
        .order('name', { ascending: true });

      if (args.methodology) query = query.eq('methodology', args.methodology);

      const { data, error } = await query;
      if (error) return err(error.message);
      return ok(data);
    }
  );

  // ─── crm.settings.ai_features.get ────────────────────────────────────────
  server.registerTool(
    'crm.settings.ai_features.get',
    {
      title: 'Get AI feature flags',
      description:
        'Read-only. Returns the current AI feature flag state for the authenticated organization: ai_enabled, ai_auto_respond, and ai_qualification_mode.',
      inputSchema: {},
    },
    async () => {
      const ctx = getMcpContext();

      const { data, error } = await getDb()
        .from('organization_settings')
        .select('ai_enabled, ai_auto_respond, ai_qualification_mode')
        .eq('organization_id', ctx.organizationId)
        .maybeSingle();

      if (error) return err(error.message);
      if (!data) return err('Organization settings not found');
      return ok(data);
    }
  );
}
