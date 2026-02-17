# OpenCode Dashboard - Statistics Roadmap

> Generated: 2026-02-17
> Status: Planning phase - discuss each before implementing

---

## Current Statistics (Already Implemented)

### Cost Metrics
- Total cost, cost by model, cost over time (30 days)
- Cost per 1K tokens, top model share
- Today vs 7-day average trend
- Monthly/yearly cost forecast

### Token Metrics
- Total input/output/reasoning/cache tokens
- Tokens by hour (today), tokens by day (365 days)
- Average tokens per request
- Token efficiency (output/input ratio)

### Performance Metrics
- Latency (avg, P95)
- Model performance (avg duration by model)
- Tool success rate, error rate by model

### Activity Metrics
- Request velocity (per day, per hour)
- Activity heatmap (day of week x hour)
- Peak cost day, peak token day
- Coding streak (current, longest)
- Session stats (avg duration, longest, sessions per day)

### Code Metrics
- File type summary (lines added/removed by extension)
- File type stats over time

### Model Metrics
- Model diversity (Shannon entropy)
- Cost by model with time filtering

---

## Tier 1: Quick Wins (Use Existing Data)

### 1. AI Acceptance Rate
- **What**: % of tool calls that succeeded vs failed
- **Data Source**: `toolCalls.success`
- **Value**: Understand how reliable AI suggestions are
- **Effort**: Low (simple aggregation)

### 2. Cache Hit Rate
- **What**: % of tokens served from cache vs fresh computation
- **Data Source**: `requests.tokensCacheRead / tokensInput`
- **Value**: Monitor cost optimization effectiveness
- **Effort**: Low (already have the data)

### 3. Tool Usage Funnel
- **What**: Which tools are used most, with success rates per tool
- **Data Source**: `toolCalls` aggregation
- **Value**: Identify problematic tools, optimize workflows
- **Effort**: Low (bar chart + success overlay)

### 4. Session Depth Distribution
- **What**: Histogram of turns per session (how deep do conversations go?)
- **Data Source**: `turns` grouped by session
- **Value**: Understand conversation patterns
- **Effort**: Low (simple grouping)

### 5. Response Time Percentiles
- **What**: P50, P75, P90, P99 latency (not just avg/P95)
- **Data Source**: `requests.durationMs`
- **Value**: Better latency understanding, SLA tracking
- **Effort**: Low (add percentile calculations)

### 6. Model Switch Frequency
- **What**: How often you switch models mid-session
- **Data Source**: `requests` grouped by session, count distinct models
- **Value**: Understand model selection patterns
- **Effort**: Low

### 7. Time to First Response
- **What**: Latency of first request in each session
- **Data Source**: `requests` ordered by session, take first
- **Value**: Measure "cold start" experience
- **Effort**: Low

### 8. Prompt Length Distribution
- **What**: Histogram of prompt lengths (chars or tokens)
- **Data Source**: `turns.prompt`
- **Value**: Understand prompting patterns
- **Effort**: Low

---

## Tier 2: Medium Effort (New Calculations)

### 9. Agent ROI Dashboard
- **What**: Cost vs output (lines of code, successful edits) per agent
- **Data Source**: Join `requests` + `fileEdits` by session
- **Value**: Which agents give best value for money?
- **Effort**: Medium (requires join logic)

### 10. Language Productivity
- **What**: Lines of code per $ spent, broken down by language
- **Data Source**: `fileEdits.fileExtension` + `requests.costUsd`
- **Value**: Which languages are most cost-effective to work on?
- **Effort**: Medium

### 11. Cost Efficiency Trend
- **What**: Cost per 1K tokens over time (are you getting cheaper?)
- **Data Source**: Daily aggregation of cost/tokens
- **Value**: Track optimization progress
- **Effort**: Medium (time series calculation)

### 12. Model Comparison Matrix
- **What**: Side-by-side comparison: cost, speed, success rate per model
- **Data Source**: Aggregated stats per model
- **Value**: Data-driven model selection
- **Effort**: Medium (UI work)

### 13. Retry Rate
- **What**: Same/similar prompts submitted multiple times
- **Data Source**: Hash `turns.prompt`, count duplicates
- **Value**: Identify frustration points
- **Effort**: Medium (hashing + similarity)

### 14. Error Recovery Time
- **What**: Time from tool failure to next successful tool call
- **Data Source**: `toolCalls` sequence analysis
- **Value**: Measure resilience
- **Effort**: Medium

### 15. Context Window Utilization
- **What**: How much of model's context limit you're using
- **Data Source**: `tokensInput / model_context_limit`
- **Value**: Optimize context usage, avoid truncation
- **Effort**: Medium (need model metadata)

### 16. Session Complexity Score
- **What**: Composite score based on: tools used, files touched, tokens consumed
- **Data Source**: Multiple tables joined
- **Value**: Categorize sessions by complexity
- **Effort**: Medium

### 17. Prompt Outcomes (Populate Existing Table)
- **What**: Track which prompts lead to successful outcomes
- **Data Source**: Populate `promptOutcomes` table (already in schema)
- **Value**: Learn what makes prompts effective
- **Effort**: Medium (backfill + ongoing collection)

---

## Tier 3: Advanced (New Data Collection Required)

### 18. Project-Level Dashboard
- **What**: Stats aggregated per `workingDir` (project)
- **Data Source**: Group all metrics by project
- **Value**: Compare productivity across projects
- **Effort**: High (new views, filtering)

### 19. Git Integration
- **What**: Commits per session, PR merge rate, lines committed
- **New Data**: Git hooks or GitHub API integration
- **Value**: Connect AI work to actual shipped code
- **Effort**: High

### 20. Build Success Rate
- **What**: Did code changes pass build/tests?
- **New Data**: CI/CD integration
- **Value**: Measure code quality
- **Effort**: High

### 21. Test Coverage Delta
- **What**: Did AI-written code include tests?
- **New Data**: Test runner integration
- **Value**: Quality assurance
- **Effort**: High

### 22. Code Review Feedback
- **What**: Human corrections to AI-generated code
- **New Data**: PR review data from GitHub
- **Value**: Measure AI accuracy
- **Effort**: High

### 23. Time Saved Estimate
- **What**: Estimated hours saved vs manual coding
- **New Data**: Benchmark data + heuristics
- **Value**: ROI justification
- **Effort**: High (requires research)

### 24. Anomaly Detection
- **What**: Alert on unusual spending/usage patterns
- **Implementation**: Statistical analysis, thresholds
- **Value**: Proactive cost control
- **Effort**: High

---

## Tier 4: Innovative / Unique Ideas

### 25. "Flow State" Detection
- **What**: Identify periods of high productivity (many requests, high success, sustained activity)
- **Value**: Gamification, understand peak performance
- **Effort**: High

### 26. Cost Anomaly Alerts
- **What**: Real-time alerts when spending exceeds thresholds
- **Value**: Budget protection
- **Effort**: Medium-High

### 27. Model Recommendation Engine
- **What**: Suggest best model for task type based on history
- **Value**: Optimize model selection automatically
- **Effort**: Very High (ML)

### 28. Prompt Templates Library
- **What**: Track which prompt patterns work best, suggest templates
- **Value**: Improve prompting over time
- **Effort**: High

### 29. Carbon Footprint Estimate
- **What**: CO2 equivalent of compute used
- **Value**: Environmental awareness
- **Effort**: Medium (lookup tables)

### 30. Learning Curve Visualization
- **What**: How your efficiency improves over time
- **Value**: Personal growth tracking
- **Effort**: Medium

### 31. "Expensive Mistakes" Log
- **What**: High-cost sessions with low output (files edited, success rate)
- **Value**: Learn from failures, cost optimization
- **Effort**: Medium

### 32. Comparative Benchmarks
- **What**: Your stats vs anonymized community averages
- **Value**: Competitive element, context for your numbers
- **Effort**: Very High (requires community data)

---

## Unused Schema: `promptOutcomes` Table

Already defined in schema but not populated:

```typescript
promptOutcomes = pgTable('prompt_outcomes', {
  promptHash: text('prompt_hash'),
  promptLength: integer('prompt_length'),
  promptPreview: text('prompt_preview'),
  toolCallCount: integer('tool_call_count'),
  successfulToolCalls: integer('successful_tool_calls'),
  failedToolCalls: integer('failed_tool_calls'),
  filesEdited: integer('files_edited'),
  tokensUsed: integer('tokens_used'),
  costUsd: doublePrecision('cost_usd'),
  userRating: integer('user_rating'),
  markedSuccessful: boolean('marked_successful')
});
```

**Recommendation**: Populate this table to enable prompt effectiveness analysis.

---

## Recommended Implementation Order

### Phase 1: Quick Wins (1-2 days each)
1. AI Acceptance Rate
2. Cache Hit Rate
3. Tool Usage Funnel
4. Session Depth Distribution
5. Response Time Percentiles

### Phase 2: High Value (3-5 days each)
1. Agent ROI Dashboard
2. Language Productivity
3. Cost Efficiency Trend
4. Model Comparison Matrix
5. Prompt Outcomes

### Phase 3: Advanced (1-2 weeks each)
1. Project-Level Dashboard
2. Git Integration
3. Anomaly Detection

### Phase 4: Plus Ultra (Research)
1. Recommendation Engine
2. Community Benchmarks
3. Flow State Detection

---

## Notes

- All Tier 1 items use existing data - no schema changes needed
- Tier 2 items may need new computed columns or views
- Tier 3+ items require new data collection mechanisms
- Discuss each item before implementing
