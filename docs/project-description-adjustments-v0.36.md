Would it be possible to extract the (approx) screen resolution for each user of the attached interaction log and adjust the log accordingly (such that it matches the current output format)?

The User bison clicks on "add another entry" at step 118 and at step 221. His browser window height should be something like 1440px.
At 610/611 are entities added to atmospheric characteristics.
At 1200 is also clicked on "add another entry"
At 1499 the user seems to click on "add 10 entries" button.
The displayed versions seem to be wrong at 1485 is says "action: mergeentries" while the display still shows the "new entry" dialog for adding new entries.

Righ click menus seem to not always show, at 1544 the action is "action: compact" but the menudialog is not displayed. For panda at step 155 the "action: open version menu" does show.

The user badger should have a resolution similar to 3840x2160 (minus browser window borders).

The user panda does click on the entry "breathable atmosphere" at step 238. The expected resolution should be around 1920x1080. At 239 the Button "close" is pressed, closing the menu.

The user Seal clicks on the button "confirm merge" at 3342. The merge window does not show and the viewport seems to be off. The resolution might be around 1920x945. At 3479 seal selects the entry "stone", at 3482 the button "delete entry" is pressed, but the context menu is closed before the mouse can hover over the option.

The hotbar should be indipendend of the resolution set in the toolbar/the user resolution size.

Panda 171 "button go to the beginning of lane" does not directly apply the action.



Regarding Bison: at 996 the cursor position seems to be approximately correct (when pressing the "add 12 entries" button).
At 602 it is somewhat borderline when pressing the "add 6 entries" button. But in the treemap view the cursor position is wrong, at about 611 multiple entries are attached to "atmospheric characteristics", but the cursor is not above that.
At 1005 "molten" is clicked on but the cursor is positioned to far down (x position might be correct, but y seems to be wrong). This continues for multiple actions after that.

user can change the state of the sidebars (collapse) during usage, so the log needs to be able to process that.

Put the "action text" in the top row of the toolbar, after "right collapsed"



Regarding Bison: Add 900 the mousewheel is not tracked or mapped to moving the scrollbar.
Beginning with step 1630 the viewport seems to be off. The cursor position does not change anymore, but actions are displayed (text), and the screen does not show anything.

Remove tooltip of "action" text. Show the current timestamp and the duration in the form 00:00:00/00:00:00 (h:m:s) between "righ collapsed" and "action" text.

For Panda the "version actions" dialog does sometimes not close when stepping forward first and stepping backwards after that.

The settings for seal do not seem to be totally correct. Steps: action at 118, at 134 Button Close (cursor is not over the button), at 196 cursor is not over button "add 1 entry". The end cursor position of the drag at 206 is not shown. At 224 the entry menu is opened, but the cursor is not above the glitter entry. Beginning with step 693 nothing is visible anymore, no version etc. At 3631 an entry is selected, but it is not visible on the screen.

are mouse movements tracked when the browserwindow is not in focus? this should not happen. (tabbing out of the window) such mouse movements do not change the view of the user and should therefore not impact the replay.