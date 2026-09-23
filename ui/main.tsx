import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { ROOT_ELEMENT_ID } from './constants.js';
import './styles.css';

const root = document.getElementById(ROOT_ELEMENT_ID);
if (root !== null) {
  createRoot(root).render(<App />);
}
