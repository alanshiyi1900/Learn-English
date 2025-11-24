export enum LearningMode {
  GUIDED_TRANSLATION = 'GUIDED', // Chinese prompt -> User translates -> AI corrects
  FREE_TALK = 'FREE_TALK' // Free conversation with correction
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isPartial?: boolean;
  correction?: string; // For extracting grammar corrections if detected
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
