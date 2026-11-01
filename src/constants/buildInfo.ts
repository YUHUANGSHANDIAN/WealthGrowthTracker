declare const __WGT_BUILD_ID__: string;
declare const __WGT_BUILD_COMMIT__: string;
declare const __WGT_BUILD_TIME__: string;

export const BUILD_ID = typeof __WGT_BUILD_ID__ === 'string' ? __WGT_BUILD_ID__ : 'development';
export const BUILD_COMMIT = typeof __WGT_BUILD_COMMIT__ === 'string' ? __WGT_BUILD_COMMIT__ : 'uncommitted';
export const BUILD_TIME = typeof __WGT_BUILD_TIME__ === 'string' ? __WGT_BUILD_TIME__ : '';
