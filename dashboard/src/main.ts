import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { createDataSource } from './lib/datasource';

mount(App, { target: document.getElementById('app')!, props: { source: createDataSource() } });
