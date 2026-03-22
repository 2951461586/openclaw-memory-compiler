import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { normalizePluginConfig } from "./src/config.ts";
import { registerMemoryCompilerPlugin } from "./src/register.ts";

export default {
  id: "memory-compiler",
  name: "Memory Compiler",
  description: "Derived memory compiler plugin shell for OpenClaw.",

  register(api: OpenClawPluginApi) {
    const config = normalizePluginConfig((api.pluginConfig || {}) as Record<string, unknown>);
    registerMemoryCompilerPlugin(api, config);
  },
};
