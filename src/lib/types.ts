export interface Profile {
  id: string;
  created_at: string;
  username: string | null;
  bio: string | null;
  avatar: string | null;
  accepting_messages: boolean;
  /** Colour-hint palette extracted from the avatar photo (max 6). */
  palette: string[] | null;
}
