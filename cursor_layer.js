/*global define console document apf */
define(function(require, module, exports) {
    main.consumes = ["Plugin", "ace", "settings", "tabManager",
        "collab.util", "collab.workspace", "timeslider"];
    main.provides = ["CursorLayer"];
    return main;

    function main(options, imports, register) {
        var Plugin      = imports.Plugin;
        var ace         = imports.ace;
        var settings    = imports.settings;
        var tabs        = imports.tabManager;
        var util        = imports["collab.util"];
        var workspace   = imports["collab.workspace"];
        var timeslider  = imports.timeslider;

        var operations = require("./ot/operations");
        var Range      = require("ace/range").Range;
        var RangeList  = require("ace/range_list").RangeList;

        // initialization
        var tooltipsInited = false;
        function initCursorLayer(collab) {
            ace.on("create", function (e) {
                initTooltipEvents(e.editor.ace);
            }, collab);
        }

        function CursorLayer(session) {

            var plugin   = new Plugin("Ajax.org", main.consumes);
            var emit     = plugin.getEmitter();

            var tsRevNum;
            var tooltipIsOpen   = false;
            var selections      = {};
            var timeslideMarker = session.addDynamicMarker({ update: drawTimeSliderOperation }, false);

            function updateSelections(selecs) {
                dispose();
                for (var clientId in selecs)
                    updateSelection(selecs[clientId]);
            }

            function drawCursor (pos, html, markerLayer, session, config, bgColor) {
                var cursorStyle = "background-color:" + util.formatColor(bgColor);

                var top = markerLayer.$getTop(pos.row, config);
                var left = Math.round(markerLayer.$padding + pos.column * config.characterWidth);
                html.push(
                    "<div class='ace_selection' style='",
                    "left:", left, "px;",
                    "top:", top + 2, "px;",
                    "height:", config.lineHeight - 2, "px;",
                    "width:", 2, "px;", (cursorStyle || ""),
                    "'></div>",
                    "<div class='ace_selection' style='",
                    "left:", left - 2, "px;",
                    "top:", top, "px;",
                    "height:", 5, "px;",
                    "width:", 6, "px;", (cursorStyle || ""),
                    "'></div>"
                );
            }

            function drawSelections(html, markerLayer, session, config) {
                if (timeslider.visible)
                    return;
                var ranges = this.rangeList.ranges;
                var screenRanges = [];

                var bgColor = workspace.colorPool[this.uid];

                if (!bgColor)
                    return console.error("[OT] selection can't find user's bg color");

                for (var i = 0; i < ranges.length; i++) {
                    var range = ranges[i];

                    if (range.end.row < config.firstRow)
                        continue;
                    else if (range.start.row > config.lastRow)
                        break;

                    var screenRange = range.toScreenRange(session);
                    screenRanges.push(screenRange);
                    renderRange(html, markerLayer, session, config, screenRange, bgColor);

                    var cursor = screenRange[range.cursor == range.start ? "start" : "end"];
                    drawCursor.call(this, cursor, html, markerLayer, session, config, bgColor);
                }
                // save screenRanges for displaying tooltips
                this.screenRanges = screenRanges;
            }

            function drawTimeSliderOperation(html, markerLayer, session, config) {
                if (!timeslider.visible)
                    return;
                var revNum = timeslider.sliderPosition;
                if (!revNum)
                    return;

                var doc = session.collabDoc;
                var revision = doc.revisions[revNum];
                var uid = revision.author;
                var bgColor;
                var editorDoc = session.doc;

                // gray for filesystem sync operations
                if(uid == 0)
                    bgColor = {r: 150, g: 150, b: 150};
                else
                    bgColor = workspace.colorPool[uid];

                if(!bgColor)
                    return console.error("[OT] timeslider can't find user's bg color");

                var scrolled = false;
                var ops = revision.operation;
                var index = 0;
                for (var i = 0; i < ops.length; i++) {
                    var len = operations.length(ops[i]);
                    switch (operations.type(ops[i])) {
                    case "retain":
                        index += len;
                        break;
                    case "insert":
                        renderInsert(index, len);
                        index += len;
                        break;
                    case "delete":
                        scrollToEdit(editorDoc.indexToPosition(index));
                        // don't render anything - those aren't visible in the current document state
                        break;
                    default:
                        throw new TypeError("Unknown operation: " + operations.type(op[i]));
                    }
                }

                function scrollToEdit(pos) {
                    if (tsRevNum === revNum)
                        return;

                    tabs.open({
                        path: doc.id,
                        document: {
                            ace: {
                                jump: {
                                    row: pos.row,
                                    column: pos.column
                                }
                            }
                        }
                    }, function () {});

                    tsRevNum = revNum;
                }

                function renderInsert(index, length) {
                    var startPos = editorDoc.indexToPosition(index);
                    scrollToEdit(startPos);
                    var endPos = editorDoc.indexToPosition(index + length);
                    var screenRange = Range.fromPoints(startPos, endPos).toScreenRange(session);
                    renderRange(html, markerLayer, session, config, screenRange, bgColor);
                }
            }

            function renderRange(html, markerLayer, session, config, screenRange, bgColor) {
                var className = "ace_selection";
                var editorDoc = session.doc;
                var selectStyle = settings.get("user/ace/@selectstyle");

                var selectionStyle = "background-color:" + util.formatColor(bgColor, 0.5) + ";" + "z-index:10;";

                function drawLine(screenRange, inline) {
                    var fullLine = inline && selectStyle === "line";
                    var height = config.lineHeight;
                    var width = (screenRange.end.column - screenRange.start.column) * config.characterWidth;

                    var top = markerLayer.$getTop(screenRange.start.row, config);
                    var left = markerLayer.$padding + screenRange.start.column * config.characterWidth;

                    html.push(
                        "<div class='", className, "' style='",
                        "height:", height, "px;",
                        fullLine ? "right:0;" : ("width:" + width + "px;"),
                        "top:", top, "px;",
                        "left:", left,"px;",
                        selectionStyle, "'></div>"
                    );
                }

                if (screenRange.isMultiLine()) {
                    var row = screenRange.start.row;
                    drawLine(new Range(row, screenRange.start.column, row, editorDoc.getLine(row).length + 1) , true);
                    row++;
                    while (row < screenRange.end.row) {
                        drawLine(new Range(row, 0, row, editorDoc.getLine(row).length + 1), true);
                        row++;
                    }
                    drawLine(new Range(row, 0, row, screenRange.end.column));
                }
                else if (!screenRange.isEmpty()) {
                    drawLine(screenRange);
                }
            }

            function dataToRangeList(data, rangeList) {
                if (typeof data[0] != "object")
                    data = [data];
                rangeList.ranges = data.map(function(d) {
                    var r = new Range(d[0], d[1], d[2], d[3]);
                    r.cursor = r[d[4] ? "start" : "end"];
                    return r;
                });
                return rangeList;
            }

            function updateSelection(data) {
                if (!session)
                    return;
                var sel = selections[data.clientId];
                if (!sel) {
                    sel = {
                        update: drawSelections,
                        drawCursor: drawCursor,
                        uid: data.userId,
                        clientId: data.clientId,
                        rangeList: new RangeList()
                    };
                    sel.rangeList.$insertRight = true;
                    sel.rangeList.attach(session);
                    session.addDynamicMarker(sel, false);
                    selections[data.clientId] = sel;
                }

                if (data.selection) {
                    dataToRangeList(data.selection, sel.rangeList);
                    session._emit("changeBackMarker");
                }
            }

            function clearSelection(clientId) {
                var selection = selections[clientId];
                if (!selection)
                    return;
                // remove the tooltip first
                if (selection.tooltip) {
                    document.body.removeChild(selection.tooltip);
                    delete selection.tooltip;
                }
                if (selection.arrow) {
                    document.body.removeChild(selection.arrow);
                    delete selection.arrow;
                }
                // remove the marker
                if (selection.id)
                    session.removeMarker(selection.id);

                selection.rangeList.detach();

                delete selections[clientId];
            }

            function hideTooltip(selection) {
                if (!selection || !selection.tooltipIsOpen || !selection.tooltip)
                    return;
                selection.tooltip.style.display = "none";
                selection.arrow.style.display = "none";
                selection.tooltipIsOpen = false;
            }

            function hideAllTooltips() {
                for (var clientId in selections)
                    hideTooltip(selections[clientId]);
                tooltipIsOpen = false;
            }

            function drawTooltip(selection, fullname) {
                var node = document.createElement("div");
                document.body.appendChild(node);

                node.className = "cool_tooltip_cursor";
                node.innerHTML = "<span class='cool_tooltip_cursor_caption'>" + apf.htmlentities(fullname) + "</span>" +
                    "<span class='cool_tooltip_cursor_button cool_tooltip_cursor_button_chat' title='Group Chat' onclick=\"requ" + "ire('ext/collaborate/collaborate').showGroupChat()\"></span>" +
                    "<span class='cool_tooltip_cursor_divider'></span>";

                // create the arrow
                var arrow = document.createElement("div");
                document.body.appendChild(arrow);
                arrow.className = "cool_tooltip_cursor_arrow";

                arrow.style.display = "none";
                node.style.display = "none";

                selection.tooltip = node;
                selection.arrow = arrow;
            }

            function showTooltip(selection, user, coords) {
                // create new tooltip if this is the first time
                if (!selection.tooltip) {
                    var uid = selection.uid;
                    var userObj = workspace.users[uid];
                    if (!userObj)
                        return;
                    drawTooltip(selection, userObj.fullname);
                }

                selection.tooltip.style.display = selection.arrow.style.display = "";
                var x = (coords.pageX - 11);
                var y = (coords.pageY - 15);
                selection.arrow.style.top  = y + "px";
                selection.arrow.style.left = x + "px";

                selection.tooltip.style.top  = (y - 21) + "px";
                selection.tooltip.style.left = (coords.pageX - (selection.tooltip.offsetWidth / 2)) + "px";

                tooltipIsOpen = selection.tooltipIsOpen = true;
            }

            function dispose() {
                for (var clientId in selections)
                    clearSelection(clientId);
            }

            function setInsertRight(clientId, val) {
                var selection = selections[clientId];
                if (selection)
                    selection.rangeList.$insertRight = val;
            }

            plugin.freezePublicAPI({
                get selections() { return selections; },
                get tooltipIsOpen() { return tooltipIsOpen; },
                updateSelection: updateSelection,
                updateSelections: updateSelections,
                clearSelection: clearSelection,
                setInsertRight: setInsertRight,
                hideTooltip: hideTooltip,
                hideAllTooltips: hideAllTooltips,
                showTooltip: showTooltip,
                dispose: dispose
            });
            
            return plugin;
        }
        
        /***** Register and define API *****/

        var editorTooltipIsOpen = false;
        var cursorTooltipTimeout;

        function initTooltipEvents(editor) {
            if (tooltipsInited) return;
            tooltipsInited = true;

            var mousePos;
            editor.addEventListener("mousemove", function(e) {
                mousePos = {x: e.x, y: e.y};
                if (!cursorTooltipTimeout)
                    cursorTooltipTimeout = setTimeout(updateTooltips,  editorTooltipIsOpen ? 100 : 300);
            });
            editor.renderer.container.addEventListener("mouseout", function(e) {
                mousePos = {x: e.clientX, y: e.clientY};
                if (!cursorTooltipTimeout)
                    cursorTooltipTimeout = setTimeout(updateTooltips,  100);
            });

            editor.addEventListener("mousewheel", function() {
                clearTimeout(cursorTooltipTimeout);
                cursorTooltipTimeout = null;
                var collabDoc = editor.session.collabDoc;
                if (collabDoc && collabDoc.isInited && collabDoc.cursorLayer.tooltipIsOpen)
                    collabDoc.cursorLayer.hideAllTooltips();
            });

            function updateTooltips() {
                cursorTooltipTimeout = null;
                var collabDoc = editor.session.collabDoc;
                if (!collabDoc || !collabDoc.isInited || timeslider.visible)
                    return;
                var cursorLayer = collabDoc.cursorLayer;
                var renderer = editor.renderer;
                var canvasPos = renderer.scroller.getBoundingClientRect();
                var screenPos = renderer.pixelToScreenCoordinates(mousePos.x, mousePos.y);

                function screenToPixelPos(pos){
                    var x = renderer.$padding + Math.round(pos.column * renderer.characterWidth);
                    var y = pos.row * renderer.lineHeight;

                    x -= renderer.scrollLeft;
                    y -= renderer.scrollTop;
                    x = Math.max(Math.min(x, canvasPos.width), 0);
                    y = Math.max(Math.min(y, canvasPos.height), 0);

                    return {
                        pageX: canvasPos.left + x,
                        pageY: canvasPos.top + y
                    };
                }

                function findTooltipPos(range) {
                    var start = range.start;
                    var end = range.end;
                    if (range.isEmpty()) {
                        if (screenPos.row != end.row)
                            return;
                        if (Math.abs(screenPos.column - end.column) <= 1)
                            return end;
                        return;
                    }

                    if (screenPos.row > end.row || screenPos.row < start.row)
                        return;
                    if (screenPos.row == end.row && screenPos.column > end.column)
                        return;
                    if (screenPos.row == start.row && screenPos.column < start.column)
                        return;

                    var d1 = screenPos.row - start.row + 0.8 * Math.abs(screenPos.column - start.column);
                    var d2 = - screenPos.row + end.row + 0.8 * Math.abs(screenPos.column - end.column);
                    return d1 < d2 ? start : end;
                }

                var clientId, tooltipIsOpen;
                var selections = cursorLayer.selections;
                for (clientId in selections) {
                    var selection = selections[clientId];
                    var user = workspace.users[selection.uid];
                    if (!selection || !user)
                        continue;

                    if (selection.tooltipIsOpen && onTooltip(selection.tooltip, mousePos)) {
                        tooltipIsOpen = true;
                        continue;
                    }

                    var tooltipPos;
                    var screenRanges = selection.screenRanges || [];
                    for (var i = screenRanges.length; i--;) {
                        tooltipPos = findTooltipPos(screenRanges[i]);
                        if (tooltipPos)
                            break;
                    }

                    if (tooltipPos) {
                        tooltipIsOpen = true;
                        cursorLayer.showTooltip(selection, user, screenToPixelPos(tooltipPos));
                    } else if (selection.tooltipIsOpen) {
                        cursorLayer.hideTooltip(selection);
                    }
                }

                editorTooltipIsOpen = tooltipIsOpen;
            }

            function onTooltip(tooltipNode, coords) {
                if (!tooltipNode)
                    return false;
                var pos = apf.getAbsolutePosition(tooltipNode);
                if (coords.x < pos[0] || coords.y < pos[1] ||
                  coords.x > tooltipNode.offsetWidth + pos[0] - 10 ||
                  coords.y > tooltipNode.offsetHeight + pos[1] + 25)
                    return false;
                return true;
            }
        }

        function selectionToData(selection) {
            var data;
            if (selection.rangeCount) {
                data = selection.rangeList.ranges.map(function(r){
                    return [r.start.row, r.start.column,
                        r.end.row, r.end.column, r.cursor == r.start];
                });
            } else {
                var r = selection.getRange();
                data = [r.start.row, r.start.column,
                    r.end.row, r.end.column, selection.isBackwards()];
            }
            return data;
        }

        CursorLayer.initCursorLayer = initCursorLayer;
        CursorLayer.selectionToData = selectionToData;

        register(null, {
            CursorLayer: CursorLayer
        });
    }
});
