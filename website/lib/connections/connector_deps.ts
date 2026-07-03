/**
 * Live `ConnectorDeps` backed by the user's active Composio connections — the
 * real IO behind the connectors read seam, kept out of the pure modules so they
 * stay unit-testable. Mirrors the inbound/proactive wiring: the same active-
 * toolkit query and the version-pinned `tools.execute` (0.10+ requires a toolkit
 * version or it throws "Toolkit version not specified").
 */

import { Composio } from "@composio/core";
import {
  CALENDAR_TOOLKIT,
  GMAIL_TOOLKIT,
  type ConnectorDeps,
  type ToolResult,
} from "@/lib/agent/connectors";
import { sql } from "@/lib/db";

export function makeConnectorDeps(): ConnectorDeps {
  return {
    activeToolkits: async (userId) => {
      const rows = await sql()<{ toolkit: string }[]>`
        SELECT toolkit FROM composio_accounts
        WHERE user_id = ${userId}
          AND status = 'active'
          AND toolkit IN (${GMAIL_TOOLKIT}, ${CALENDAR_TOOLKIT})
      `;
      return new Set(rows.map((r) => r.toolkit));
    },
    executeTool: async (userId, slug, args) => {
      const key = process.env.COMPOSIO_API_KEY;
      if (!key) throw new Error("COMPOSIO_API_KEY is not configured");
      const composio = new Composio({ apiKey: key });
      const result = await composio.tools.execute(slug, {
        userId,
        arguments: args,
        version: "latest",
        dangerouslySkipVersionCheck: true,
      });
      return {
        data: (result?.data ?? {}) as Record<string, unknown>,
        error: result?.error ?? null,
        successful: result?.successful === true,
      } satisfies ToolResult;
    },
  };
}
