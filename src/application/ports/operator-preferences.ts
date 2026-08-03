export interface UIPreferenceEntry {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

export interface UIPreferencesRepository {
  findAll(): Promise<readonly UIPreferenceEntry[]>;
  findByKey(_key: string): Promise<UIPreferenceEntry | undefined>;
  save(_entry: UIPreferenceEntry): Promise<void>;
  deleteByKey(_key: string): Promise<void>;
  clear(): Promise<void>;
}
