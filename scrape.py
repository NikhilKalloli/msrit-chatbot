import requests
import json
from dotenv import load_dotenv
import os

load_dotenv()

CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")

def get_markdown_content(url: str):
    try:
        api_url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown"
        headers = {
            "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
            "Content-Type": "application/json"
        }
        body = json.dumps({ "url": url })
        response = requests.post(api_url, headers=headers, data=body)
        data = response.json()

        if not data.get("success"):
            error_message = f"Error extracting markdown for {url}: {json.dumps(data.get('errors', data), indent=2)}"
            return error_message

        print(data.get("result"))
        return data.get("result")

    except Exception as e:
        return None

def get_all_hyperlinks(url: str):
    try:
        api_url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/browser-rendering/links"
        headers = {
            "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
            "Content-Type": "application/json"
        }
        body = json.dumps({ "url": url })
        response = requests.post(api_url, headers=headers, data=body)
        data = response.json()

        if not data.get("success"):
            error_message = f"Error extracting links for {url}: {json.dumps(data.get('errors', data), indent=2)}"
            return None

        return data.get("result")

    except Exception as e:
        return None

# print(get_markdown_content("https://msrit.edu"))
print(get_all_hyperlinks("https://msrit.edu"))