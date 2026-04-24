import React, {createContext, useContext} from 'react';
import {dark} from './themes';

const ThemeContext = createContext(dark);

export function ThemeProvider({theme, children}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
