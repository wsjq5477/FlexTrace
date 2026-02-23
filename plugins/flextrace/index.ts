import { FlexTracePlugin } from "./src/opencode_plugin.js";
import { createFlexTracePlugin } from "./src/flextrace_plugin.js";

export { createFlexTracePlugin };
export { FlexTracePlugin };
export default FlexTracePlugin;
export { createOpenCodeFlexTrace } from "./src/opencode_plugin.js";
export type { FlexTraceConfig, FlexTracePlugin as FlexTraceCorePlugin } from "./src/flextrace_plugin.js";
export type { TraceRecord } from "./src/trace_record.js";
