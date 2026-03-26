# azure_network.tf – VNet, subnet, NSG, public IP for Azure demo estate

# ── Resource Group ─────────────────────────────────────────────────────────────
# If use_existing_resource_group = true  → reference an existing RG (CSP/restricted subscriptions)
# If use_existing_resource_group = false → create a new RG (full Contributor access)

resource "azurerm_resource_group" "demo" {
  count    = var.use_existing_resource_group ? 0 : 1
  name     = "rg-${local.prefix}"
  location = var.azure_location
  tags     = local.tags
}

data "azurerm_resource_group" "existing" {
  count = var.use_existing_resource_group ? 1 : 0
  name  = var.existing_resource_group_name
}

locals {
  # Single reference used by all other resources — resolves to whichever path is active
  rg_name     = var.use_existing_resource_group ? data.azurerm_resource_group.existing[0].name     : azurerm_resource_group.demo[0].name
  rg_location = var.use_existing_resource_group ? data.azurerm_resource_group.existing[0].location : azurerm_resource_group.demo[0].location
}

resource "azurerm_virtual_network" "demo" {
  name                = "vnet-${local.prefix}"
  address_space       = ["10.20.0.0/16"]
  location            = local.rg_location
  resource_group_name = local.rg_name
  tags                = local.tags
}

resource "azurerm_subnet" "windows" {
  name                 = "snet-windows-targets"
  resource_group_name  = local.rg_name
  virtual_network_name = azurerm_virtual_network.demo.name
  address_prefixes     = ["10.20.1.0/24"]
}

# ── Public IP for Windows target (WinRM + RDP access) ─────────────────────────
resource "azurerm_public_ip" "windows_target" {
  name                = "pip-win-target-${local.prefix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

# ── NSG: allow WinRM from AAP EIP, RDP from operator only ────────────────────
resource "azurerm_network_security_group" "windows_target" {
  name                = "nsg-win-target-${local.prefix}"
  resource_group_name = local.rg_name
  location            = local.rg_location

  # WinRM HTTPS – from AAP Elastic IP (Ansible connects here)
  security_rule {
    name                       = "AllowWinRM-from-AAP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5986"
    source_address_prefix      = aws_eip.aap.public_ip   # Only from AAP
    destination_address_prefix = "*"
  }

  # RDP – operator access for manual verification during demo
  security_rule {
    name                       = "AllowRDP-from-Operator"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = var.operator_cidr
    destination_address_prefix = "*"
  }

  # WinRM from operator – for local ansible-playbook testing before demo
  security_rule {
    name                       = "AllowWinRM-from-Operator"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5986"
    source_address_prefix      = var.operator_cidr
    destination_address_prefix = "*"
  }

  # Deny all other inbound
  security_rule {
    name                       = "DenyAllOtherInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = local.tags
}

resource "azurerm_network_interface" "windows_target" {
  name                = "nic-win-target-${local.prefix}"
  resource_group_name = local.rg_name
  location            = local.rg_location

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = azurerm_subnet.windows.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.windows_target.id
  }

  tags = local.tags
}

resource "azurerm_network_interface_security_group_association" "windows_target" {
  network_interface_id      = azurerm_network_interface.windows_target.id
  network_security_group_id = azurerm_network_security_group.windows_target.id
}
