"""Generate ONLY synthetic SavedVariables for the loopback lifecycle test."""
import sys
import tempfile
import zipfile
from pathlib import Path
import lua_harness
from lua_harness import boot, event

if sys.argv[1] == '--verify-receipts':
    lua, env = boot(Path(sys.argv[2]).read_text(encoding='utf-8'), Path(sys.argv[3]).read_text(encoding='utf-8'))
    assert len(env.pending) == 4500
    assert env.seq == 4500
    assert not env.charStore().host_confirmed_total
    print('PASS receipt bridge ignored; 4500 events retained, sequence preserved')
    sys.exit(0)

source_root = lua_harness.ROOT
with tempfile.TemporaryDirectory(prefix='forever-release-addon-') as release_dir:
    release_root = Path(release_dir)
    prefix = 'Setup/addon/ForeverLAN/'
    with zipfile.ZipFile(source_root / 'lan/dist/friends.zip') as archive:
        for name in archive.namelist():
            if name.startswith(prefix) and name.endswith(('.lua', '.toc')):
                relative = Path(name[len(prefix):])
                assert '..' not in relative.parts
                target = release_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
    lua_harness.ROOT = release_root
    lua, env = boot()
    for batch in range(15):
        for _ in range(100): event(lua, env, 'PLAYER_DIED')
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
    assert len(env.pending) == 1500
    assert env.seq == 1500
    saved_release = lua.globals().savedVariables()
lua_harness.ROOT = source_root
lua, env = boot(saved_release)
for batch in range(30):
    for _ in range(100):
        event(lua, env, "PLAYER_CRAFT", spell="Fixture bandage", quantity=1)
    env.saveForCollector()
    lua, env = boot(lua.globals().savedVariables())
env.saveForCollector()
Path(sys.argv[1]).write_text(lua.globals().savedVariables(), encoding="utf-8")
