export interface Document {
  path: string;
  title: string;
  description?: string;
  content: string;
  category: 'main' | 'epic' | 'story' | 'research' | 'retrospective';
  epicId?: string;
  storyId?: string;
  wordCount: number;
  lineCount: number;
  lastModified: number;
  headings: Array<{
    level: number;
    text: string;
    id: string;
  }>;
}

export interface DocumentMetadata {
  path: string;
  title: string;
  description?: string;
  category: Document['category'];
  epicId?: string;
  storyId?: string;
  wordCount: number;
  lineCount: number;
  lastModified: number;
}

export interface DocumentNavigation {
  main: Array<{
    id: string;
    title: string;
    path: string;
  }>;
  epics: Array<{
    id: string;
    title: string;
    techSpec?: string;
    stories: Array<{
      id: string;
      title: string;
      path: string;
    }>;
  }>;
  research: Array<{
    id: string;
    title: string;
    path: string;
  }>;
  retrospectives: Array<{
    id: string;
    title: string;
    path: string;
  }>;
}
