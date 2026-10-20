// url=https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp/Ramble-Core-Flow-Wireframes?node-id=33-159
// source=src/primitives/Button.tsx
// component=Button
import figma from 'figma';
const instance = figma.selectedInstance;

const label = instance.getString('label');
const variant = instance.getEnum('variant', { primary: 'primary', secondary: 'secondary', ghost: 'ghost' });
const size = instance.getEnum('size', { md: 'md', lg: 'lg' });
// The state variant maps to props and to pseudo-states, not to separate props.
const state = instance.getEnum('state', { default: 'default', hover: 'hover', focus: 'focus', disabled: 'disabled', loading: 'loading' });
const showIcon = instance.getBoolean('showIcon');
const icon = showIcon ? instance.getInstanceSwap('iconStart') : null;
let iconCode;
if (icon && icon.type === 'INSTANCE') {
  iconCode = icon.executeTemplate().example;
}

export default {
  example: figma.code`<Button variant="${variant}" size="${size}"${state === 'disabled' ? ' disabled' : ''}${state === 'loading' ? ' loading' : ''}${iconCode ? figma.code` iconStart={${iconCode}}` : ''}>${label}</Button>`,
  imports: ['import { Button } from "@/primitives/Button"'],
  id: 'button',
  metadata: { nestable: true },
};
