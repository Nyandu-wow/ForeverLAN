' Forever LAN — silent keep-alive (no window).
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""E:\OneDrive\Private\Cursor\FOREVER\phase1\scripts\watchdog.ps1""", 0, False
