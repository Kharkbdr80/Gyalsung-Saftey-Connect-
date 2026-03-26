export type Role = 'HQ_ADMIN' | 'ACADEMY_STAFF' | 'STUDENT' | 'ERT';

export interface Academy {
  id: string;
  name: string;
  logo?: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  academy_id: string;
  academy_name?: string;
  email?: string;
}

export interface Incident {
  id: string;
  academy_id: string;
  academy_name: string;
  reporter_id: string;
  reporter_name: string;
  type: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  location: string;
  description: string;
  immediate_action: string;
  ga_recommendation?: string;
  ghq_recommendation?: string;
  photo?: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  created_at: string;
}

export interface Action {
  id: string;
  incident_id: string;
  assignee_id: string;
  assignee_name: string;
  description: string;
  status: 'Pending' | 'Completed';
  due_date: string;
  completed_at?: string;
}

export interface Inspection {
  id: string;
  academy_id: string;
  academy_name: string;
  inspector_id: string;
  inspector_name: string;
  title: string;
  status: string;
  created_at: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  incident_type: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'recommendation' | 'status_change' | 'action_assigned';
  related_id: string;
  read: boolean;
  created_at: string;
}
