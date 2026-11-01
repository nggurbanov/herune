import {createContext, useContext} from 'react'
/** The host wraps each mounted contribution with its actual pane visibility. */
export const PaneVisibilityContext = createContext(false)
export const PaneVisibilityProvider = PaneVisibilityContext.Provider
export function usePaneVisible() { return useContext(PaneVisibilityContext) }
