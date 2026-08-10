import { ActionConfig } from '../../../../shared/types';

export interface ActionExecutor {
  execute(action: ActionConfig): Promise<{ success: boolean; error?: string }>;
}
