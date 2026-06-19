/** Phase 3 — multi-agent pipeline types (orchestrator → knowledge → edit → review). */

export type AgentId =
  | 'knowledge_agent'
  | 'slide_language_agent'
  | 'layout_agent'
  | 'slide_editor_agent'
  | 'knowledge_mapping_agent'
  | 'validation_agent'
  | 'version_commit_agent'

export type OrchestratorTaskType =
  | 'knowledge_based_slide_edit'
  | 'design_only_edit'
  | 'full_deck_build'
  | 'mechanical_edit'
  | 'informational'

export type OrchestratorPlan = {
  task_type: OrchestratorTaskType
  required_agents: AgentId[]
  target_slide_ids: string[]
  approval_required: boolean
  knowledge_required: boolean
}

export type KnowledgeNodeRef = {
  id: string
  type: 'Claim' | 'Metric' | 'Topic'
  name: string
  status: 'candidate' | 'approved' | 'rejected'
  description?: string | null
  evidence?: string | null
}

export type SemanticEditPlan = {
  main_message: string
  claims_to_use: KnowledgeNodeRef[]
  metrics_to_use: KnowledgeNodeRef[]
  topics: KnowledgeNodeRef[]
  sources: { id: string; title: string }[]
  claims_to_remove: KnowledgeNodeRef[]
  risk_flags: string[]
  /** Linked deck elements for target slides (from Map deck). */
  deck_links: {
    slideId: string
    elementId: string
    elementName: string
    knowledgeNodeId: string
    knowledgeName: string
    knowledgeType: string
  }[]
}

export type ValidationSeverity = 'low' | 'medium' | 'high'

export type ValidationIssue = {
  type:
    | 'unapproved_claim'
    | 'unsupported_claim'
    | 'cognitive_load'
    | 'missing_evidence'
    | 'contradiction'
  severity: ValidationSeverity
  message: string
  node_id?: string
  slide_id?: string
}

export type ValidationResult = {
  validation_result: 'pass' | 'needs_fix' | 'human_review'
  scores: {
    factual_accuracy: number
    layout_quality: number
    brand_compliance: number
    narrative_consistency: number
    cognitive_load: number
  }
  issues: ValidationIssue[]
  recommended_action: 'commit' | 'revise_before_commit' | 'request_human_review'
}

export type AgentPlanResponse = {
  orchestrator: OrchestratorPlan
  semantic_edit_plan: SemanticEditPlan | null
  plan_context: string
  has_graph_knowledge: boolean
}
