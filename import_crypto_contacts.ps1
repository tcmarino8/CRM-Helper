param(
    [string]$ApiBase = "http://127.0.0.1:8000",
    [string]$FilePath = "Crypto Contacts.md",
    [int]$Limit = 0
)

$body = @{
    file_path = $FilePath
}

if ($Limit -gt 0) {
    $body.limit = $Limit
}

$uri = "$($ApiBase.TrimEnd('/'))/graph/import/crypto_contacts"
$payload = $body | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $payload