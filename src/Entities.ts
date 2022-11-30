/**
 * Remote versions
 */
export interface IVerions extends Record<string, string> {
    core: string;
}

/**
 * Version name type
 */
export type VersionName = keyof IVerions & string;

/**
 * Settings
 */
export interface ISettings {
    loadedApps?: VersionName[];
    current?: VersionName;
    apps?: Partial<IVerions>;
}
