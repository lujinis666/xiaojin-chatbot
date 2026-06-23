import os

with open('backups/index_backup.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract CSS
css_start = content.find('<style>')
css_end = content.find('</style>')
css_content = content[css_start+7:css_end].strip()

# Extract JS
js_start = content.find('<script>')
js_end = content.rfind('</script>')
js_content = content[js_start+8:js_end].strip()

# New HTML
html_new = content[:css_start] + '<link rel="stylesheet" href="/static/css/style.css">\n' + content[css_end+8:js_start] + '<script src="/static/js/main.js"></script>\n' + content[js_end+9:]

with open('static/css/style.css', 'w', encoding='utf-8') as f:
    f.write(css_content)

with open('static/js/main.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

with open('templates/index.html', 'w', encoding='utf-8') as f:
    f.write(html_new)

print("Split completed successfully.")
