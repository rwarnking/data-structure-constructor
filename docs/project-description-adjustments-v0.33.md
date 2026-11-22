When clicking "export interaction log" i get an error "interaction produces an invalid room state" on the browser console. this does not happen always, but i added the room data for which this happened.
- the room was open for a long time (80 min)
- there were 3 participant in the room
- all other participants left the room before exporting
- the data contains two merges
- branching was disabled and later on enabled for the room

First check if there is a way to obtain the interaction log data (for example through the browser console) even if it is only partially available or broken or if it is lost.
Do not yet try to fix the problem.

# Answer

Do not reload or close the tab. In its browser console, paste:

(() => {
  const original = JSON.parse;
  window.restoreCanopyJSONParse = () => { JSON.parse = original; };
  JSON.parse = function (...args) {
    const result = original.apply(this, args);
    if (result?.format === 'canopy-interaction-log' &&
        result.room === 'space_group_1') {
      window.recoveredCanopyLog = result;
      window.restoreCanopyJSONParse();
      console.info('Captured log:', result.events.length, 'events');
    }
    return result;
  };
  console.info('Ready. Click Export Interaction Log now.');
})();

Click Export Interaction Log again. The error may recur, but the console should say Captured log. Then save it:

const url = URL.createObjectURL(new Blob(
  [JSON.stringify(window.recoveredCanopyLog, null, 2)],
  { type: 'application/json' }
));
const link = document.createElement('a');
link.href = url;
link.download = 'canopy-interactions-recovered.json';
link.click();
setTimeout(() => URL.revokeObjectURL(url), 10000);

This saves the raw recording; it may still fail replay validation. It can contain entered text and cursor positions, so share it carefully.

> here is the recovered interaction log. it seems like it can not be loaded. Indentify the problem and fix the file if possible.

Repaired file: canopy-interactions-recovered-g1-repaired.json

A child version was recorded before its parent; individual replays also lacked versions created by other participants. I restored missing dependencies from snapshots already in the log, preserving all 11,606 events. Some snapshots now appear earlier than recorded, so replay timing is approximate.

The repaired file loads, all four participant replays reach the end, and the combined final version trees match the saved room data. The original file is unchanged.

> The repaired version works, but the viewport seems to wrongly placed. At least do the mouse positions and movements not match the position of used buttons. The mouse position and camera position seem to be off in general when replaying.
Investigate this and fix this if possible. Also investigate what the origin of the other issues was and fix that in the code. Maybe also add saveguards for example that the data is exported even if it is corrupted.