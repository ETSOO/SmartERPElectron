/**
 * Remote versions
 */
export interface IVersions extends Record<string, string> {
    core: string;
}

/**
 * Version name type
 */
export type VersionName = keyof IVersions & string;

/**
 * Settings
 */
export interface ISettings {
    loadedApps?: VersionName[];
    current?: VersionName;
    apps?: Partial<IVersions>;
}
