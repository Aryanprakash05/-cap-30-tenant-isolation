import React from 'react'
import ReactDOM from 'react-dom/client'
// No font import: the Apple pass uses the platform system font (SF Pro
// on the Mac) via --font in index.css. The @fontsource-variable/inter
// dependency stays in package.json so the lockfile is untouched.
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
