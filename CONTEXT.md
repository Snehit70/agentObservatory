# OpenCode Dashboard

This context defines the telemetry language for tracking LLM usage, sessions, and coding activity in the dashboard.

## Language

**Session**:
A bounded work period whose requests and activity are tracked together.
_Avoid_: chat, run

**Request**:
A single model invocation recorded with tokens, latency, and cost.
_Avoid_: call, query

**Turn**:
A user-to-assistant exchange treated as one conversational step.
_Avoid_: message pair, interaction

**Tool Call**:
A recorded invocation of an external or local tool during a session.
_Avoid_: action, command

**Daily Summary**:
A pre-aggregated rollup of usage for one calendar day.
_Avoid_: daily stats, day report
