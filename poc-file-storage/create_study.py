from storage.local import LocalPersistentStorage
store = LocalPersistentStorage(root="./data", sqlite_url="sqlite:///storage.sqlite3")
sid = store.create_study(external_id="CASE-HTTP")
print("STUDY_ID=", sid)
store.dispose()

# 9a9573d0-c6f8-43dd-9960-5521ba95776b