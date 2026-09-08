export function pageRefIdentityCase() {
  return String.raw`
    const task = await taskSpace(taskName);
    for (const scope of ['subtree', 'only_within_viewport']) {
      const page = await newPageAt(task, baseUrl + '/nav-target');
      try {
        await page.evaluate((offscreen) => {
          document.body.innerHTML = '<button id="first" aria-label="First ref action">First ref action</button><button id="second" aria-label="Second ref action">Second ref action</button>';
          window.__refClicks = { first: 0, second: 0 };
          for (const id of ['first', 'second']) {
            document.getElementById(id).onclick = () => window.__refClicks[id]++;
          }
          if (offscreen) {
            document.body.style.height = '2000px';
            document.getElementById('first').style.cssText = 'position:absolute;top:1500px';
          }
        }, scope === 'only_within_viewport');
        const full = await page.snapshot({ scope: 'full_page' });
        const refFor = (snapshot, name) => {
          const line = snapshot.split('\n').find((line) => line.includes(name));
          const match = line && line.match(/\[ref=(\d+)/);
          assert(match, 'snapshot exposes ' + name + ': ' + snapshot);
          return '@' + match[1];
        };
        const firstRef = refFor(full, 'First ref action');
        const secondRef = refFor(full, 'Second ref action');
        const partial = await page.snapshot({ scope, ...(scope === 'subtree' ? { root: secondRef } : {}) });
        assertEqual(refFor(partial, 'Second ref action'), secondRef, scope + ' preserves the second button ref');
        assert(!partial.includes('First ref action'), scope + ' omits the first button');
        await page.click(firstRef);
        const clicks = await page.evaluate(() => window.__refClicks);
        assertEqual(clicks.first, 1, scope + ' keeps the omitted first ref bound to the first button');
        assertEqual(clicks.second, 0, scope + ' never redirects that ref to the second button');
      } finally {
        await page.close();
      }
    }
  `;
}

export function pageRefPrepareRoundCase() {
  return String.raw`
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + '/nav-target');
    await page.evaluate(() => {
      document.body.innerHTML = '<button id="first" aria-label="First round action">First round action</button><button id="second" aria-label="Second round action">Second round action</button>';
      window.__refClicks = { first: 0, second: 0 };
      for (const id of ['first', 'second']) document.getElementById(id).onclick = () => window.__refClicks[id]++;
    });
    const initial = await page.snapshot();
    const line = initial.split('\n').find((line) => line.includes('Second round action'));
    const match = line && line.match(/\[ref=(\d+)/);
    assert(match, 'initial snapshot publishes the second button ref');
    const subtree = await page.snapshot({ scope: 'subtree', root: '@' + match[1] });
    const published = subtree.split('\n').find((line) => line.includes('Second round action')).match(/\[ref=(\d+)/);
    assert(published, 'the final snapshot publishes a ref for the second button');
    await writeFile(join(tempDir, 'page-ref-round.json'), JSON.stringify({ label: page.label, ref: '@' + published[1] }));
  `;
}

export function pageRefResumeRoundCase() {
  return String.raw`
    const saved = JSON.parse(await readFile(join(tempDir, 'page-ref-round.json'), 'utf8'));
    const task = await taskSpace(taskName);
    const page = task.page(saved.label);
    try {
      await page.click(saved.ref);
      const clicks = await page.evaluate(() => window.__refClicks);
      assertEqual(clicks.second, 1, 'the published subtree ref still clicks the second button in a new round');
      assertEqual(clicks.first, 0, 'restoring a ref never renumbers it to the first button');
      await assertRejects(() => page.click(saved.ref), 'Stale ref', 'actions invalidate saved refs');
    } finally {
      await page.close();
    }
  `;
}
