# Making User-Diagram Flows

Each diagram is described in a small Python script (`uf1_A.py`, `uf3_A.py`, …), which lists the
boxes, their positions and the arrows between them. `uflib.py` holds the shared shapes and colours
(the same as in the legend).

Running a script writes a `.drawio` file. The draw.io program (in Docker) then turns it into a PDF,
which goes into the thesis.

To rebuild all diagrams (needs Docker):

```sh
./export.sh
```

To rebuild one diagram: `./export.sh uf1_A.py`

To change a diagram, edit its script and run `export.sh` again. You can also open the `.drawio`
file in draw.io and edit it by hand, but the next script run will overwrite those edits.