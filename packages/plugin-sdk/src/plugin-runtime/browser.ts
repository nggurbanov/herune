import { installPluginSdk, sdkImportMap } from '../runtime'
import type { RuntimeModuleHost } from './loader'

/** Browser renderer's live React/JSX/SDK singleton boundary. */
export function browserRuntimeModules(): RuntimeModuleHost {
  installPluginSdk()
  return {
    importMap: sdkImportMap(),
    createModuleUrl: source => URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
    revokeModuleUrl: url => URL.revokeObjectURL(url),
    importModule: url => import(/* @vite-ignore */ url)
  }
}
