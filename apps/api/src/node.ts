import { node } from '@elysia/node';
import { Elysia } from 'elysia';

import { createApp } from './app.js';

new Elysia({ adapter: node() }).use(createApp()).listen(3000);
