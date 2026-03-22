import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MemoryCompilerPluginConfig } from "./config.ts";
import { buildRuntimeContext, runSessionLifecycle } from "./runtime.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";
import { initializeMemoryCompilerLayout } from "./init.ts";

export function registerMemoryCompilerPlugin(api: OpenClawPluginApi, config: MemoryCompilerPluginConfig) {
  if (!config.enabled) return;

  const paths = resolveMemoryCompilerPaths(config);
  initializeMemoryCompilerLayout(config);
  api.logger.info(`memory-compiler plugin enabled (workspaceDir=${paths.workspaceDir}, dataDir=${paths.dataDir}, runtimeDir=${paths.runtimeDir}, mode=${config.controlPlaneMode})`);

  if (config.enableRuntimeBridge) {
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        try {
          const sessionKey = typeof (ctx as any)?.sessionKey === "string" ? String((ctx as any).sessionKey) : "";
          const result = await buildRuntimeContext(config, {
            prompt: (event as any)?.prompt,
            sessionKey,
          });
          if (result.prependContext.trim() || result.prependSystemContext.trim()) {
            return {
              ...(result.prependContext.trim() ? { prependContext: result.prependContext } : {}),
              ...(result.prependSystemContext.trim() ? { prependSystemContext: result.prependSystemContext } : {}),
            };
          }
        } catch (err) {
          api.logger.warn(`memory-compiler: before_prompt_build failed: ${String(err)}`);
        }
      },
      { priority: 14 },
    );
  }

  if (config.enableSessionLifecycle) {
    api.on(
      "session_end",
      async (_event, ctx) => {
        try {
          const sessionKey = typeof (ctx as any)?.sessionKey === "string" ? String((ctx as any).sessionKey).trim() : "";
          await runSessionLifecycle(config, sessionKey, "plugin-session-end");
        } catch (err) {
          api.logger.warn(`memory-compiler: session_end failed: ${String(err)}`);
        }
      },
      { priority: 18 },
    );
  }
}
