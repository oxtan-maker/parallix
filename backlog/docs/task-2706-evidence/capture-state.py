import json,sqlite3,sys,pathlib
root=pathlib.Path(__file__).parent
location=json.loads((root/'session-location.json').read_text())
db=sqlite3.connect(location['directory']+'/operator.db'); db.row_factory=sqlite3.Row
result={}
for table in ['missions','mission_descriptions','mission_labels','mission_success_criteria','mission_dependencies','mission_briefs','mission_brief_out_of_scope','adhoc_mission_counters','mission_lane_events']:
    if db.execute("select 1 from sqlite_master where name=?",(table,)).fetchone():
        result[table]=[dict(r) for r in db.execute('select * from '+table)]
(root/(sys.argv[1]+'.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
