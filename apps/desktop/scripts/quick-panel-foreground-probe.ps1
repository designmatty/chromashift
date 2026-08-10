param(
  [Parameter(Mandatory = $true)]
  [string]$KeystrokeLogPath
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ChromaShift foreground probe'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(520, 180)
$form.TopMost = $false

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(20, 20)
$label.Text = 'This window must retain foreground and keyboard input while the quick panel is used.'
$form.Controls.Add($label)

$input = New-Object System.Windows.Forms.TextBox
$input.Location = New-Object System.Drawing.Point(20, 60)
$input.Size = New-Object System.Drawing.Size(480, 30)
$input.Add_KeyPress({
  param($sender, $eventArgs)
  Add-Content -LiteralPath $KeystrokeLogPath -Value ([string]$eventArgs.KeyChar) -NoNewline
})
$form.Controls.Add($input)

$form.Add_Shown({
  $form.Activate()
  $input.Focus()
  [Console]::Out.WriteLine($form.Handle.ToInt64())
  [Console]::Out.Flush()
})

[System.Windows.Forms.Application]::Run($form)
