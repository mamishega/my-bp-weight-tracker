import { it, expect } from 'vitest';
import axe from 'axe-core';
it('axe detects a real violation (sanity check)', async () => {
  const div = document.createElement('div');
  div.innerHTML = '<input type="text"><button></button><img src="x.png">';
  document.body.appendChild(div);
  const res = await axe.run(div, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  div.remove();
  expect(res.violations.map((v) => v.id).sort()).toEqual(expect.arrayContaining(['button-name', 'image-alt', 'label']));
});
