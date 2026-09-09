import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ['https://www.googleapis.com/auth/drive']
HERE = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(HERE, 'drive_client_secret.json')
TOKEN_PATH = os.path.join(HERE, 'drive_token.json')

flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
creds = flow.run_local_server(port=8765, open_browser=False, prompt='consent')

with open(TOKEN_PATH, 'w') as f:
    f.write(creds.to_json())

print("SAVED TOKEN")
